import { describe, expect, it } from 'vitest';
import { asObjectArray, replacementPair, toolFilePath } from './session-tool-args';

describe('toolFilePath', () => {
  it('reads canonical snake_case and historical camelCase spellings', () => {
    expect(toolFilePath({ file_path: 'a.ts' })).toBe('a.ts');
    expect(toolFilePath({ filePath: 'a.ts' })).toBe('a.ts');
    expect(toolFilePath({ path: 'a.ts' })).toBe('a.ts');
  });
});

describe('replacementPair', () => {
  it('reads canonical, historical and short-form names', () => {
    for (const args of [
      { old_string: 'a', new_string: 'b' },
      { oldString: 'a', newString: 'b' },
      { old_str: 'a', new_str: 'b' },
      { old_text: 'a', new_text: 'b' }
    ]) {
      expect(replacementPair(args)).toEqual({ oldText: 'a', newText: 'b' });
    }
  });

  it('prefers the canonical name when both are present', () => {
    expect(replacementPair({ old_string: 'canon', oldString: 'legacy', new_string: 'x' })).toEqual({
      oldText: 'canon',
      newText: 'x'
    });
  });

  it('returns null when no replacement fields exist', () => {
    expect(replacementPair({ file_path: 'a.ts' })).toBeNull();
  });
});

describe('asObjectArray', () => {
  it('decodes a JSON string holding an array of objects (pre-normalisation records)', () => {
    expect(asObjectArray('[{"oldString":"a"}]')).toEqual([{ oldString: 'a' }]);
  });

  it('rejects strings that are not arrays of objects', () => {
    expect(asObjectArray('not json')).toBeNull();
    expect(asObjectArray('{"a":1}')).toBeNull();
    expect(asObjectArray('[]')).toBeNull();
    expect(asObjectArray(['x'])).toBeNull();
  });
});
