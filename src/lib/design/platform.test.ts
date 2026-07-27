import { describe, expect, it } from 'vitest';
import { formatAriaShortcut, formatShortcut, getPrimaryModifierLabel, isMacPlatform } from './platform';

const macNavigator = { platform: 'MacIntel', userAgent: 'Mozilla/5.0' };
const linuxNavigator = { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0' };

describe('platform shortcuts', () => {
  it('uses Cmd and Meta labels on Apple platforms', () => {
    expect(isMacPlatform(macNavigator)).toBe(true);
    expect(getPrimaryModifierLabel(macNavigator)).toBe('Cmd');
    expect(formatShortcut('Shift+Z', macNavigator)).toBe('Cmd+Shift+Z');
    expect(formatAriaShortcut('1', macNavigator)).toBe('Meta+1');
  });

  it('uses Ctrl and Control labels on non-Apple platforms', () => {
    expect(isMacPlatform(linuxNavigator)).toBe(false);
    expect(getPrimaryModifierLabel(linuxNavigator)).toBe('Ctrl');
    expect(formatShortcut('P', linuxNavigator)).toBe('Ctrl+P');
    expect(formatAriaShortcut('0', linuxNavigator)).toBe('Control+0');
  });
});
