import { describe, expect, it } from 'vitest';
import { clearDesktopLocalStorage } from './app-reset';

function memory(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    data
  };
}

describe('clearDesktopLocalStorage', () => {
  it('removes only desktop keys', () => {
    const storage = memory({
      'querymt-desktop.agents': '[]',
      'querymt.themeMode': 'dark',
      'querymt-mobile.other': 'x',
      unrelated: 'y'
    });
    expect(clearDesktopLocalStorage(storage)).toBe(2);
    expect([...storage.data.keys()]).toEqual(['querymt-mobile.other', 'unrelated']);
  });
});
