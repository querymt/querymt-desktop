import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState, UpdatesStatus } from '$lib/querymt/updates';

vi.mock('$app/environment', () => ({ browser: true }));

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class {
    onmessage: ((event: unknown) => void) | undefined;
  }
}));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

function status(overrides: Partial<UpdatesStatus> = {}): UpdatesStatus {
  return {
    channel: 'stable',
    buildChannel: 'stable',
    currentVersion: '0.1.10',
    qmtcodeVersion: '0.5.2',
    installKind: 'macApp',
    autoCheck: true,
    sendStatistics: true,
    skippedVersion: null,
    lastCheck: null,
    state: { kind: 'idle' },
    ...overrides
  };
}

const available = (overrides: Partial<Extract<UpdateState, { kind: 'available' }>> = {}): UpdateState => ({
  kind: 'available',
  version: '0.1.11',
  notes: null,
  date: null,
  qmtcodeVersion: '0.5.3',
  canInstall: true,
  releaseUrl: 'https://example.test/release',
  skipped: false,
  ...overrides
});

let emitState: ((state: UpdateState) => void) | undefined;

async function loadStore() {
  vi.resetModules();
  const { UpdatesStore } = await import('./updates.svelte');
  return new UpdatesStore();
}

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
  emitState = undefined;
  listen.mockImplementation(async (_event: string, handler: (e: { payload: UpdateState }) => void) => {
    emitState = (state) => handler({ payload: state });
    return () => {};
  });
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

describe('UpdatesStore', () => {
  it('loads the status and follows updates://state events', async () => {
    invoke.mockResolvedValueOnce(status());
    const store = await loadStore();
    await store.initialize();

    expect(invoke).toHaveBeenCalledWith('updates_status');
    expect(listen).toHaveBeenCalledWith('updates://state', expect.any(Function));
    expect(store.status?.currentVersion).toBe('0.1.10');

    emitState?.(available());
    expect(store.state.kind).toBe('available');
  });

  it('does nothing outside the Tauri runtime', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const store = await loadStore();
    await store.initialize();

    expect(invoke).not.toHaveBeenCalled();
    expect(store.supported).toBe(false);
  });

  it('saves the channel and auto-check through updates_set_preferences', async () => {
    invoke.mockResolvedValueOnce(status());
    const store = await loadStore();
    await store.initialize();

    invoke.mockResolvedValueOnce(status({ channel: 'nightly' }));
    await store.setChannel('nightly');
    expect(invoke).toHaveBeenLastCalledWith('updates_set_preferences', { patch: { channel: 'nightly' } });
    expect(store.status?.channel).toBe('nightly');

    invoke.mockResolvedValueOnce(status({ autoCheck: false }));
    await store.setAutoCheck(false);
    expect(invoke).toHaveBeenLastCalledWith('updates_set_preferences', { patch: { autoCheck: false } });
  });

  it('saves the statistics preference independently of auto-check', async () => {
    invoke.mockResolvedValueOnce(status());
    const store = await loadStore();
    await store.initialize();
    expect(store.status?.sendStatistics).toBe(true);

    invoke.mockResolvedValueOnce(status({ sendStatistics: false }));
    await store.setSendStatistics(false);
    expect(invoke).toHaveBeenLastCalledWith('updates_set_preferences', { patch: { sendStatistics: false } });
    expect(store.status?.sendStatistics).toBe(false);
    expect(store.status?.autoCheck).toBe(true);
  });

  it('runs a manual check and reports its failure', async () => {
    invoke.mockResolvedValueOnce(status());
    const store = await loadStore();
    await store.initialize();

    invoke.mockResolvedValueOnce(status({ state: { kind: 'upToDate' } }));
    await store.checkNow();
    expect(invoke).toHaveBeenLastCalledWith('updates_check', { manual: true });
    expect(store.state.kind).toBe('upToDate');
    expect(store.checking).toBe(false);

    invoke.mockRejectedValueOnce('Could not reach the update server: offline');
    await store.checkNow();
    expect(store.actionError).toBe('Could not reach the update server: offline');
    expect(store.checking).toBe(false);
  });

  it('prompts for an available update until it is skipped or postponed', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();
    expect(store.prompt?.kind).toBe('available');

    store.later('0.1.11');
    expect(store.prompt).toBeNull();

    // A later version prompts again.
    emitState?.(available({ version: '0.1.12' }));
    expect(store.prompt?.kind).toBe('available');
  });

  it('does not prompt for a skipped version and persists the skip', async () => {
    invoke.mockResolvedValueOnce(status({ state: available({ skipped: true }) }));
    const store = await loadStore();
    await store.initialize();
    expect(store.prompt).toBeNull();

    invoke.mockResolvedValueOnce(status({ skippedVersion: '0.1.11' }));
    await store.skip('0.1.11');
    expect(invoke).toHaveBeenLastCalledWith('updates_set_preferences', { patch: { skippedVersion: '0.1.11' } });
  });

  it('hides the prompt right after a skip and shows it again on reopen', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();
    expect(store.prompt?.kind).toBe('available');

    invoke.mockResolvedValueOnce(status({ skippedVersion: '0.1.11', state: available() }));
    await store.skip('0.1.11');
    expect(store.prompt).toBeNull();

    store.reopen();
    expect(store.prompt?.kind).toBe('available');
  });

  it('accumulates download progress while installing', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();

    const seen: Array<{ received: number; total: number | null } | null> = [];
    invoke.mockImplementationOnce(async (_cmd: string, args: { onEvent: { onmessage: (e: unknown) => void } }) => {
      args.onEvent.onmessage({ event: 'started', contentLength: 100 });
      args.onEvent.onmessage({ event: 'progress', chunkLength: 40 });
      args.onEvent.onmessage({ event: 'progress', chunkLength: 25 });
      seen.push(store.progress ? { ...store.progress } : null);
    });
    await store.install();

    expect(invoke).toHaveBeenLastCalledWith('updates_install', { onEvent: expect.anything() });
    expect(seen[0]).toEqual({ received: 65, total: 100 });
    expect(store.progress).toBeNull();
    expect(store.actionError).toBeNull();
  });

  it('shows an install failure and clears progress', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();

    invoke.mockRejectedValueOnce('Update download failed: signature mismatch');
    await store.install();
    expect(store.actionError).toBe('Update download failed: signature mismatch');
    expect(store.progress).toBeNull();
  });

  it('restarts through updates_restart', async () => {
    invoke.mockResolvedValueOnce(status());
    const store = await loadStore();
    await store.initialize();

    invoke.mockResolvedValueOnce(undefined);
    await store.restart();
    expect(invoke).toHaveBeenLastCalledWith('updates_restart');
  });

  it('reopen overrides a saved skip for the reviewed version', async () => {
    invoke.mockResolvedValueOnce(status({ skippedVersion: '0.1.11', state: available({ skipped: true }) }));
    const store = await loadStore();
    await store.initialize();
    expect(store.prompt).toBeNull();

    store.reopen();
    expect(store.prompt?.kind).toBe('available');
  });

  it('a manual check that finds the postponed version shows the prompt again', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();
    store.later('0.1.11');
    expect(store.prompt).toBeNull();

    invoke.mockResolvedValueOnce(status({ state: available() }));
    await store.checkNow();
    expect(store.dismissedVersion).toBeNull();
    expect(store.prompt?.kind).toBe('available');
  });

  it('a manual check keeps the dismissal for a different version', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();
    store.later('0.1.10');

    invoke.mockResolvedValueOnce(status({ state: available() }));
    await store.checkNow();
    expect(store.dismissedVersion).toBe('0.1.10');
  });

  it('keeps a failed install visible, but not a failed automatic check', async () => {
    invoke.mockResolvedValueOnce(status({ state: available() }));
    const store = await loadStore();
    await store.initialize();

    const error: UpdateState = { kind: 'error', message: 'boom', failure: 'other', manual: true };
    emitState?.(error);
    expect(store.prompt).toBeNull();

    invoke.mockRejectedValueOnce('Update install failed: disk full');
    await store.install();
    expect(store.installError).toBe('Update install failed: disk full');
    expect(store.prompt).toEqual(error);

    store.dismissInstallError();
    expect(store.prompt).toBeNull();
  });
});
