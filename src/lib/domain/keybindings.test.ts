import { describe, expect, it } from 'vitest';
import { buildKeybindings, KEYBINDINGS } from './keybindings';

describe('buildKeybindings', () => {
  it('defaults to Enter to send with Shift+Enter for a new line', () => {
    const entries = buildKeybindings('enter');
    expect(entries.find((entry) => entry.label === 'Send prompt')?.keys).toEqual(['Enter']);
    expect(entries.find((entry) => entry.label === 'New line in prompt')?.keys).toEqual(['Shift', 'Enter']);
  });

  it('reflects the shift-enter send shortcut', () => {
    const entries = buildKeybindings('shift-enter');
    expect(entries.find((entry) => entry.label === 'Send prompt')?.keys).toEqual(['Shift', 'Enter']);
    expect(entries.find((entry) => entry.label === 'New line in prompt')?.keys).toEqual(['Enter']);
  });

  it('reflects modifier send shortcuts', () => {
    expect(buildKeybindings('ctrl-enter').find((entry) => entry.label === 'Send prompt')?.keys).toEqual([
      'Ctrl',
      'Enter'
    ]);
    expect(buildKeybindings('cmd-enter').find((entry) => entry.label === 'Send prompt')?.keys).toEqual([
      'Cmd',
      'Enter'
    ]);
  });

  it('exposes the default list for the default send shortcut', () => {
    expect(KEYBINDINGS).toEqual(buildKeybindings('enter'));
  });
});
