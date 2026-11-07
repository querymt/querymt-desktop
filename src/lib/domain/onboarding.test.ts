import { describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  detectFirstRun,
  isOnboardingDone,
  loadOnboardingState,
  markOnboardingCompleted,
  markOnboardingSkipped,
  runFirstRunRedirect
} from './onboarding';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data
  };
}

describe('onboarding', () => {
  it('treats a fresh install as a first run', () => {
    const store = memory();
    expect(detectFirstRun(store)).toBe(true);
    expect(store.data.has(ONBOARDING_STORAGE_KEY)).toBe(false);
  });

  it('records existing users as completed', () => {
    const store = memory({ 'querymt-desktop.recent-sessions': '[]' });
    expect(detectFirstRun(store)).toBe(false);
    expect(isOnboardingDone(loadOnboardingState(store))).toBe(true);
  });

  it('is not a first run after completing or skipping', () => {
    const completed = memory();
    markOnboardingCompleted(completed);
    expect(detectFirstRun(completed)).toBe(false);
    const skipped = memory();
    markOnboardingSkipped(skipped);
    expect(loadOnboardingState(skipped)).toMatchObject({ version: ONBOARDING_VERSION, completedAt: null });
    expect(detectFirstRun(skipped)).toBe(false);
  });

  it('ignores a corrupt value', () => {
    const store = memory({ [ONBOARDING_STORAGE_KEY]: '{not json' });
    expect(loadOnboardingState(store)).toBeNull();
    expect(detectFirstRun(store)).toBe(true);
  });

  it('re-offers onboarding for an older version', () => {
    const store = memory({ [ONBOARDING_STORAGE_KEY]: JSON.stringify({ version: 0, completedAt: '2020-01-01', skippedAt: null }) });
    expect(isOnboardingDone(loadOnboardingState(store))).toBe(false);
  });
});

describe('runFirstRunRedirect', () => {
  const base = () => ({
    initialized: Promise.resolve(),
    isSetupComplete: () => false,
    currentPath: () => '/',
    openSetup: vi.fn(),
    markCompleted: vi.fn()
  });

  it('does nothing for existing users', async () => {
    const input = base();
    expect(await runFirstRunRedirect({ ...input, firstRun: false })).toBe('none');
    expect(input.openSetup).not.toHaveBeenCalled();
  });

  it('opens setup on a fresh install from the start screen', async () => {
    const input = base();
    expect(await runFirstRunRedirect({ ...input, firstRun: true })).toBe('setup');
    expect(input.openSetup).toHaveBeenCalledOnce();
  });

  it('records completion when setup is already usable', async () => {
    const input = { ...base(), isSetupComplete: () => true };
    expect(await runFirstRunRedirect({ ...input, firstRun: true })).toBe('completed');
    expect(input.markCompleted).toHaveBeenCalledOnce();
    expect(input.openSetup).not.toHaveBeenCalled();
  });

  it('never redirects from deep links', async () => {
    const input = { ...base(), currentPath: () => '/sessions/a/b' };
    expect(await runFirstRunRedirect({ ...input, firstRun: true })).toBe('none');
    expect(input.openSetup).not.toHaveBeenCalled();
  });

  it('stops waiting after the cap when initialization hangs', async () => {
    vi.useFakeTimers();
    try {
      const input = { ...base(), initialized: new Promise(() => undefined) };
      const result = runFirstRunRedirect({ ...input, firstRun: true, capMs: 10_000 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toBe('setup');
    } finally {
      vi.useRealTimers();
    }
  });
});
