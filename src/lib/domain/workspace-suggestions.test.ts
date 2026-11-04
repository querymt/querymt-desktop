import { describe, expect, it } from 'vitest';
import { mergeWorkspaceSuggestions } from './workspace-suggestions';

describe('mergeWorkspaceSuggestions', () => {
  it('lists saved workspaces before recent ones', () => {
    expect(mergeWorkspaceSuggestions([{ path: '/a' }, { path: '/b' }], ['/c', '/d'])).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('drops duplicates, ignoring trailing slashes, keeping the first', () => {
    expect(mergeWorkspaceSuggestions([{ path: '/a/' }], ['/a', '/b', '/b/'])).toEqual(['/a/', '/b']);
  });

  it('skips blank paths and keeps the root path', () => {
    expect(mergeWorkspaceSuggestions([{ path: '  ' }, { path: '/' }], ['', '/'])).toEqual(['/']);
  });

  it('caps the list', () => {
    const saved = Array.from({ length: 12 }, (_, index) => ({ path: `/w${index}` }));
    expect(mergeWorkspaceSuggestions(saved, ['/extra'])).toHaveLength(8);
    expect(mergeWorkspaceSuggestions(saved, [], 3)).toEqual(['/w0', '/w1', '/w2']);
  });
});
