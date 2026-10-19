import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyActiveSession, applySessionNotification } from '$lib/domain/session-updates';
import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
import SessionToolPatchDiff from './SessionToolPatchDiff.svelte';
import { appearanceStore } from '$lib/stores/appearance.svelte';

const renderer = vi.hoisted(() => ({ create: vi.fn(), hydrate: vi.fn(), cleanUp: vi.fn() }));
vi.mock('$app/state', () => ({ page: { params: { agentId: 'agent-1' } } }));
vi.mock('@pierre/diffs', () => ({
  getSingularPatch: (patch: string) => ({ patch }),
  FileDiff: class {
    constructor() { renderer.create(); }
    hydrate({ fileContainer }: { fileContainer: HTMLElement }) {
      renderer.hydrate();
      const code = document.createElement('pre');
      code.textContent = 'highlighted patch';
      fileContainer.append(code);
    }
    cleanUp() { renderer.cleanUp(); }
  }
}));

afterEach(() => { cleanup(); appearanceStore.resolvedTheme = 'light'; vi.clearAllMocks(); });

describe('completed diff stability during active-turn streaming', () => {
  it.each([false, true])('keeps an open diff mounted while new server chunks arrive (finalized turn=%s)', async (finalized) => {
    let session = createEmptyActiveSession();
    const sessionId = 'streaming-highlight';
    session.sessionId = sessionId;
    session = applySessionNotification(session, { sessionId, update: {
      sessionUpdate: 'user_message_chunk', messageId: 'user-1', content: { type: 'text', text: 'Edit this file' }
    } });
    session = applySessionNotification(session, { sessionId, update: {
      sessionUpdate: 'tool_call', toolCallId: 'edit-1', title: 'Run multiedit', kind: 'edit', status: 'completed',
      rawInput: { filePath: 'src/app.ts', edits: [{ oldString: 'const value = 1;', newString: 'const value = 2;' }] },
      rawOutput: 'OK paths=1 edits=1 added=1 deleted=1\nP src/app.ts\nH replace old=1,1 new=1,1 +1 -1'
    } });
    session = applySessionNotification(session, { sessionId, update: {
      sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking the change' }
    } });
    if (finalized) {
      session = applySessionNotification(session, { sessionId, update: {
        sessionUpdate: 'user_message_chunk', messageId: 'user-2', content: { type: 'text', text: 'Next task' }
      } });
    }
    const { rerender } = render(ActiveSessionView, { session });
    if (finalized) await fireEvent.click(screen.getByRole('button', { name: /Worked through/ }));
    const details = screen.getByText('Edit file').closest('details')!;
    await fireEvent.click(details.querySelector('summary')!);
    const host = await screen.findByTestId('session-tool-diff');
    await waitFor(() => expect(renderer.hydrate).toHaveBeenCalledOnce());
    const highlighted = host.querySelector('pre');
    for (const text of [' and testing', ' the result', ' now']) {
      session = applySessionNotification(session, { sessionId, update: {
        sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text }
      } });
      await rerender({ session });
    }
    expect(details.open).toBe(true);
    expect(screen.getByTestId('session-tool-diff')).toBe(host);
    expect(renderer.create).toHaveBeenCalledOnce();
    expect(host.querySelector('pre')).toBe(highlighted);
    expect(renderer.hydrate).toHaveBeenCalledOnce();
    expect(renderer.cleanUp).not.toHaveBeenCalled();
  });

  it('still renders actual patch, file header and theme changes and cleans up on unmount', async () => {
    const { container, rerender, unmount } = render(SessionToolPatchDiff, { patch: 'first patch' });
    await waitFor(() => expect(renderer.hydrate).toHaveBeenCalledOnce());
    const initial = container.querySelector('pre');
    await rerender({ patch: 'first patch' });
    expect(container.querySelector('pre')).toBe(initial);
    expect(renderer.create).toHaveBeenCalledOnce();
    await rerender({ patch: 'second patch' });
    expect(renderer.create).toHaveBeenCalledTimes(2);
    expect(renderer.cleanUp).toHaveBeenCalledOnce();
    expect(container.querySelector('pre')).not.toBe(initial);
    await rerender({ hideFileHeader: true });
    expect(renderer.create).toHaveBeenCalledTimes(3);
    appearanceStore.resolvedTheme = 'dark';
    await waitFor(() => expect(renderer.create).toHaveBeenCalledTimes(4));
    unmount();
    expect(renderer.cleanUp).toHaveBeenCalledTimes(4);
  });
});
