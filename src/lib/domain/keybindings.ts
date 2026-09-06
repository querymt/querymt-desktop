export type KeybindingScope = 'global' | 'session' | 'composer';

export interface KeybindingEntry {
  keys: string[];
  label: string;
  scope: KeybindingScope;
}

/**
 * Inventory of the app's keyboard shortcuts. Editing individual bindings is
 * not supported yet — this list is rendered read-only in Settings →
 * Keybindings.
 *
 * Keep in sync with the keyboard handlers in:
 * - src/routes/+layout.svelte (global shortcuts, double-Esc cancel)
 * - src/routes/sessions/[agentId]/[sessionId]/+page.svelte (undo/redo)
 * - src/lib/components/primitives/SessionComposer.svelte (model picker,
 *   reasoning, mode cycling, send)
 */
export const KEYBINDINGS: KeybindingEntry[] = [
  { keys: ['Ctrl/Cmd', 'N'], label: 'New session', scope: 'global' },
  { keys: ['Ctrl/Cmd', 'P'], label: 'Toggle command palette', scope: 'global' },
  { keys: ['Ctrl/Cmd', '1-9'], label: 'Open rail session 1-9', scope: 'global' },
  { keys: ['Ctrl/Cmd', '0'], label: 'Open rail session 10', scope: 'global' },
  { keys: ['Esc', 'Esc'], label: 'Cancel the running agent', scope: 'global' },
  { keys: ['Ctrl/Cmd', 'Z'], label: 'Undo workspace to latest turn', scope: 'session' },
  { keys: ['Ctrl/Cmd', 'Shift', 'Z'], label: 'Redo workspace change', scope: 'session' },
  { keys: ['Ctrl/Cmd', 'M'], label: 'Open model quick picker', scope: 'composer' },
  { keys: ['Ctrl/Cmd', 'T'], label: 'Cycle reasoning option', scope: 'composer' },
  { keys: ['Tab'], label: 'Cycle mode option (Plan/Build)', scope: 'composer' },
  { keys: ['Enter'], label: 'Send prompt', scope: 'composer' },
  { keys: ['Shift', 'Enter'], label: 'New line in prompt', scope: 'composer' }
];

export const KEYBINDING_SCOPES: Array<{
  id: KeybindingScope;
  label: string;
  description: string;
}> = [
  { id: 'global', label: 'Global', description: 'Available anywhere in the app' },
  { id: 'session', label: 'Session view', description: 'Inside an open session' },
  { id: 'composer', label: 'Composer', description: 'While the prompt composer is focused' }
];
