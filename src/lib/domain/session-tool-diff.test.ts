import { getSingularPatch } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import { buildSessionToolDiffs } from './session-tool-diff';

const MERMAID_OLD = [
  'let mermaidPromise: Promise<MermaidApi> | null = null;',
  'let mermaidRenderId = 0;',
  'let mermaidSourceId = 0;',
  "let mermaidTheme: 'dark' | 'light' | null = null;",
  'const mermaidRoots = new Set<HTMLElement>();',
  'let mermaidThemeObserver: MutationObserver | null = null;'
].join('\n');

const MERMAID_NEW = [
  'let mermaidPromise: Promise<MermaidApi> | null = null;',
  'let mermaidRenderId = 0;',
  'let mermaidSourceId = 0;',
  "let mermaidTheme: 'dark' | 'light' | null = null;",
  'const mermaidRenderGenerations = new WeakMap<HTMLElement, number>();',
  'const mermaidRoots = new Set<HTMLElement>();',
  'let mermaidThemeObserver: MutationObserver | null = null;'
].join('\n');

const MERMAID_PATH = '/projects/querymt-org/querymt-desktop/src/lib/components/session/code-blocks.ts';
const MERMAID_GENERATION = 'const mermaidRenderGenerations = new WeakMap<HTMLElement, number>();';
const MERMAID_RECEIPT = [
  'OK paths=1 edits=1 added=1 deleted=0',
  `P ${MERMAID_PATH}`,
  'H replace old=228,6 new=228,7 +1 -0'
].join('\n');

function patchLines(patch: string | undefined): string[] {
  return (patch ?? '').split('\n');
}

function hunkBodies(patch: string | undefined): string[][] {
  const bodies: string[][] = [];
  let current: string[] | null = null;
  for (const line of patchLines(patch)) {
    if (line.startsWith('@@ ')) {
      current = [];
      bodies.push(current);
      continue;
    }
    current?.push(line);
  }
  return bodies;
}

describe('buildSessionToolDiffs', () => {
  it('builds a unified patch from edit input, including snake_case keys', () => {
    const [file] = buildSessionToolDiffs(
      'edit',
      'completed',
      '{"path":"src/app.ts","oldString":"hello","newString":"world"}',
      'OK paths=1 edits=1 added=1 deleted=1'
    );

    expect(file?.path).toBe('src/app.ts');
    expect(file?.patch).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(file?.patch).toContain('-hello');
    expect(file?.patch).toContain('+world');
    expect((file?.patch.match(/^@@ /gm) || []).length).toBe(1);

    const snake = buildSessionToolDiffs(
      'edit',
      'completed',
      '{"file_path":"src/app.ts","old_string":"hello","new_string":"world"}'
    );
    expect(snake[0]?.patch).toContain('-hello');
    expect(snake[0]?.patch).toContain('+world');
  });

  it('preserves unchanged lines as context for a simple insertion and deletion', () => {
    const [insertion] = buildSessionToolDiffs(
      'edit',
      'completed',
      JSON.stringify({ path: 'src/app.ts', oldString: 'hello\nworld', newString: 'hello\nthere\nworld' })
    );
    expect(insertion?.patch).toContain('@@ -1,2 +1,3 @@');
    expect(hunkBodies(insertion?.patch)[0]).toEqual([' hello', '+there', ' world']);

    const [deletion] = buildSessionToolDiffs(
      'edit',
      'completed',
      JSON.stringify({ path: 'src/app.ts', oldString: 'hello\nthere\nworld', newString: 'hello\nworld' })
    );
    expect(deletion?.patch).toContain('@@ -1,3 +1,2 @@');
    expect(hunkBodies(deletion?.patch)[0]).toEqual([' hello', '-there', ' world']);
  });

  it('anchors the mermaid insertion fixture to receipt coordinates and Pierre fields', () => {
    const [file] = buildSessionToolDiffs(
      'edit',
      'completed',
      JSON.stringify({ filePath: MERMAID_PATH, oldString: MERMAID_OLD, newString: MERMAID_NEW }),
      MERMAID_RECEIPT
    );

    expect(file?.path).toBe(MERMAID_PATH);
    expect(file?.patch).toContain('diff --git a/projects/querymt-org/querymt-desktop/src/lib/components/session/code-blocks.ts b/projects/querymt-org/querymt-desktop/src/lib/components/session/code-blocks.ts');
    expect(file?.patch).toContain('@@ -228,6 +228,7 @@');
    expect(file?.patch).not.toContain('\\ No newline at end of file');

    const body = hunkBodies(file?.patch)[0] ?? [];
    expect(body).toEqual([
      ' let mermaidPromise: Promise<MermaidApi> | null = null;',
      ' let mermaidRenderId = 0;',
      ' let mermaidSourceId = 0;',
      " let mermaidTheme: 'dark' | 'light' | null = null;",
      `+${MERMAID_GENERATION}`,
      ' const mermaidRoots = new Set<HTMLElement>();',
      ' let mermaidThemeObserver: MutationObserver | null = null;'
    ]);
    expect(body.filter((line) => line.startsWith('+'))).toEqual([`+${MERMAID_GENERATION}`]);
    expect(body.filter((line) => line.startsWith('-'))).toEqual([]);

    const parsed = getSingularPatch(file?.patch ?? '');
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]).toMatchObject({
      deletionStart: 228,
      deletionCount: 6,
      additionStart: 228,
      additionCount: 7,
      additionLines: 1,
      deletionLines: 0,
      collapsedBefore: 227
    });
  });

  it('falls back to snippet-relative starts when result is missing or the OK receipt is malformed', () => {
    const args = JSON.stringify({ path: 'src/app.ts', oldString: MERMAID_OLD, newString: MERMAID_NEW });
    const expectedBody = [
      ' let mermaidPromise: Promise<MermaidApi> | null = null;',
      ' let mermaidRenderId = 0;',
      ' let mermaidSourceId = 0;',
      " let mermaidTheme: 'dark' | 'light' | null = null;",
      `+${MERMAID_GENERATION}`,
      ' const mermaidRoots = new Set<HTMLElement>();',
      ' let mermaidThemeObserver: MutationObserver | null = null;'
    ];

    for (const result of [undefined, 'OK src/app.ts updated', 'OK paths=1 edits=1 added=1 deleted=0']) {
      const [file] = buildSessionToolDiffs('edit', 'completed', args, result);
      expect(file?.patch).toContain('@@ -1,6 +1,7 @@');
      expect(hunkBodies(file?.patch)[0]).toEqual(expectedBody);
      const parsed = getSingularPatch(file?.patch ?? '');
      expect(parsed.hunks[0]).toMatchObject({
        deletionStart: 1,
        deletionCount: 6,
        additionStart: 1,
        additionCount: 7,
        additionLines: 1,
        deletionLines: 0,
        collapsedBefore: 0
      });
    }
  });

  it('does not emit no-newline markers for equivalent trailing-newline snippets', () => {
    const withNewline = buildSessionToolDiffs(
      'edit',
      'completed',
      JSON.stringify({ path: 'src/app.ts', oldString: 'hello\n', newString: 'world\n' })
    );
    const withoutNewline = buildSessionToolDiffs(
      'edit',
      'completed',
      JSON.stringify({ path: 'src/app.ts', oldString: 'hello', newString: 'world' })
    );

    expect(withNewline[0]?.patch).toBe(withoutNewline[0]?.patch);
    expect(withNewline[0]?.patch).not.toContain('\\ No newline at end of file');
    expect(withNewline[0]?.patch).toContain('-hello');
    expect(withNewline[0]?.patch).toContain('+world');
  });

  it('builds one file patch with multiple hunks from multiedit input', () => {
    const files = buildSessionToolDiffs(
      'multiedit',
      'completed',
      '{"filePath":"src/lib.ts","edits":[{"oldString":"foo","newString":"bar"},{"oldString":"baz","newString":"qux"}]}'
    );

    expect(files).toHaveLength(1);
    const patch = files[0]?.patch ?? '';
    expect((patch.match(/^diff --git /gm) || []).length).toBe(1);
    expect((patch.match(/^@@ /gm) || []).length).toBe(2);
    expect(patch).toContain('-foo');
    expect(patch).toContain('+bar');
    expect(patch).toContain('-baz');
    expect(patch).toContain('+qux');
  });

  it('anchors distinct multiedit hunks to distant receipt coordinates and sorts them', () => {
    const files = buildSessionToolDiffs(
      'multiedit',
      'completed',
      JSON.stringify({
        filePath: 'src/lib.ts',
        edits: [
          { oldString: 'zzz', newString: 'www' },
          { oldString: 'aa\nbb', newString: 'aa\ncc\nbb' }
        ]
      }),
      [
        'OK paths=1 edits=2 added=2 deleted=1',
        'P src/lib.ts',
        'H replace old=10,2 new=10,3 +1 -0',
        'H replace old=80,1 new=81,1 +1 -1'
      ].join('\n')
    );

    expect(files).toHaveLength(1);
    const patch = files[0]?.patch ?? '';
    expect(patch).toContain('@@ -10,2 +10,3 @@');
    expect(patch).toContain('@@ -80,1 +81,1 @@');
    expect(patch.indexOf('@@ -10,2 +10,3 @@')).toBeLessThan(patch.indexOf('@@ -80,1 +81,1 @@'));
    expect(hunkBodies(patch)).toEqual([
      [' aa', '+cc', ' bb'],
      ['-zzz', '+www']
    ]);

    const parsed = getSingularPatch(patch);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0]).toMatchObject({
      deletionStart: 10,
      deletionCount: 2,
      additionStart: 10,
      additionCount: 3,
      additionLines: 1,
      deletionLines: 0
    });
    expect(parsed.hunks[1]).toMatchObject({
      deletionStart: 80,
      deletionCount: 1,
      additionStart: 81,
      additionCount: 1,
      additionLines: 1,
      deletionLines: 1
    });
    expect(parsed.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
  });

  it('falls back entirely to neutral geometry when receipt hunks cannot be matched unambiguously', () => {
    const mismatch = buildSessionToolDiffs(
      'multiedit',
      'completed',
      JSON.stringify({
        filePath: 'src/lib.ts',
        edits: [
          { oldString: 'aa\nbb', newString: 'aa\ncc\nbb' },
          { oldString: 'zzz', newString: 'www' }
        ]
      }),
      [
        'OK paths=1 edits=1 added=1 deleted=0',
        'P src/lib.ts',
        'H replace old=10,2 new=10,3 +1 -0'
      ].join('\n')
    );
    const mismatchPatch = mismatch[0]?.patch ?? '';
    expect(mismatchPatch).toContain('@@ -1,2 +1,3 @@');
    expect(mismatchPatch).toContain('@@ -1,1 +1,1 @@');
    expect(mismatchPatch).not.toContain('@@ -10,');
    const mismatchParsed = getSingularPatch(mismatchPatch);
    expect(mismatchParsed.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([0, 0]);

    const duplicate = buildSessionToolDiffs(
      'multiedit',
      'completed',
      JSON.stringify({
        filePath: 'src/lib.ts',
        edits: [
          { oldString: 'foo', newString: 'bar' },
          { oldString: 'baz', newString: 'qux' }
        ]
      }),
      [
        'OK paths=1 edits=2 added=2 deleted=2',
        'P src/lib.ts',
        'H replace old=10,1 new=10,1 +1 -1',
        'H replace old=40,2 new=40,3 +1 -0'
      ].join('\n')
    );
    const duplicatePatch = duplicate[0]?.patch ?? '';
    expect(duplicatePatch).toContain('@@ -1,1 +1,1 @@');
    expect(duplicatePatch).not.toContain('@@ -10,');
    expect(duplicatePatch).not.toContain('@@ -40,');
    expect(getSingularPatch(duplicatePatch).hunks.map((hunk) => hunk.collapsedBefore)).toEqual([0, 0]);
  });

  it('renders write_file as a new-file patch using content line splitting', () => {
    const files = buildSessionToolDiffs(
      'write_file',
      'completed',
      '{"path":"src/new.ts","content":"export const value = 1;\\nexport const other = 2;\\n"}'
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.patch).toContain('diff --git a/src/new.ts b/src/new.ts');
    expect(files[0]?.patch).toContain('new file mode 100644');
    expect(files[0]?.patch).toContain('@@ -0,0 +1,2 @@');
    expect(files[0]?.patch).toContain('+export const value = 1;');
    expect(files[0]?.patch).toContain('+export const other = 2;');
  });

  it('renders write_file from JSON success and suppresses malformed results', () => {
    const args = '{"path":"src/new.ts","content":"export const value = 1;\\n"}';
    const [file] = buildSessionToolDiffs('write_file', 'completed', args, '{"path":"src/new.ts","bytes":24}');
    expect(file?.patch).toContain('+export const value = 1;');

    expect(buildSessionToolDiffs('write_file', 'completed', args, '{"path":"src/new.ts"}')).toEqual([]);
    expect(buildSessionToolDiffs('write_file', 'completed', args, '{"path":"","bytes":24}')).toEqual([]);
    expect(buildSessionToolDiffs('write_file', 'completed', args, 'write failed')).toEqual([]);
  });

  it('groups replace_symbol replacements by path', () => {
    const files = buildSessionToolDiffs(
      'replace_symbol',
      'completed',
      JSON.stringify({
        replacements: [
          { path: 'src/a.ts', oldText: 'alpha', newText: 'beta' },
          { path: 'src/b.ts', old_text: 'gamma', new_text: 'delta' }
        ]
      })
    );

    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files[0]?.patch).toContain('-alpha');
    expect(files[0]?.patch).toContain('+beta');
    expect(files[1]?.patch).toContain('-gamma');
    expect(files[1]?.patch).toContain('+delta');
  });

  it('renders replace_symbol from Updated results and addition-only newText', () => {
    const [pair] = buildSessionToolDiffs(
      'replace_symbol',
      'completed',
      JSON.stringify({ path: 'src/a.ts', oldText: 'alpha', newText: 'beta' }),
      'Updated 1 symbol(s).\n- replaced Foo in src/a.ts'
    );
    expect(pair?.patch).toContain('-alpha');
    expect(pair?.patch).toContain('+beta');

    const [additionOnly] = buildSessionToolDiffs(
      'replace_symbol',
      'completed',
      JSON.stringify({ path: 'src/a.ts', newText: 'export const value = 1;\nexport const other = 2;' }),
      'Updated 1 symbol(s).'
    );
    expect(additionOnly?.patch).toContain('@@ -0,0 +1,2 @@');
    expect(hunkBodies(additionOnly?.patch)[0]).toEqual(['+export const value = 1;', '+export const other = 2;']);
    expect(hunkBodies(additionOnly?.patch)[0]?.some((line) => line.startsWith('-'))).toBe(false);

    expect(
      buildSessionToolDiffs(
        'replace_symbol',
        'completed',
        JSON.stringify({ path: 'src/a.ts', oldText: 'alpha', newText: 'beta' }),
        'symbol not found'
      )
    ).toEqual([]);
  });

  it('skips patches for failed or non-OK results and unknown tools', () => {
    expect(
      buildSessionToolDiffs(
        'edit',
        'completed',
        '{"path":"src/app.ts","oldString":"one","newString":"two"}',
        'oldString not found'
      )
    ).toEqual([]);
    expect(buildSessionToolDiffs('shell', 'completed', '{"command":"git status"}')).toEqual([]);
    expect(buildSessionToolDiffs('apply_patch', 'completed', '{"patch":"diff --git a/x b/x"}')).toEqual([]);
  });

  it('skips speculative diffs unless the tool completed successfully', () => {
    const args = '{"path":"src/app.ts","oldString":"hello","newString":"world"}';
    expect(buildSessionToolDiffs('edit', 'in_progress', args)).toEqual([]);
    expect(buildSessionToolDiffs('edit', 'failed', args)).toEqual([]);
    expect(buildSessionToolDiffs('edit', 'pending', args)).toEqual([]);
    expect(buildSessionToolDiffs('edit', 'completed', args)).toHaveLength(1);
    expect(buildSessionToolDiffs('edit', 'completed', args, 'OK paths=1 edits=1 added=1 deleted=1')).toHaveLength(1);
  });

  it('parses unequal-length multi-edit hunks without phantom collapsed gaps', () => {
    const files = buildSessionToolDiffs(
      'multiedit',
      'completed',
      JSON.stringify({
        filePath: 'src/lib.ts',
        edits: [
          { oldString: 'a\nb', newString: 'a\nb\nc' },
          { oldString: 'x', newString: '' }
        ]
      })
    );

    expect(files).toHaveLength(1);
    const parsed = getSingularPatch(files[0]?.patch ?? '');
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([0, 0]);
    expect(parsed.hunks.map((hunk) => ({ additionStart: hunk.additionStart, deletionStart: hunk.deletionStart }))).toEqual([
      { additionStart: 1, deletionStart: 1 },
      { additionStart: 0, deletionStart: 1 }
    ]);
    expect(files[0]?.patch).toContain('@@ -1,2 +1,3 @@');
    expect(files[0]?.patch).toContain('@@ -1,1 +0,0 @@');
    expect(hunkBodies(files[0]?.patch)).toEqual([[' a', ' b', '+c'], ['-x']]);
  });

  it('parses edit and write_file patches with Pierre', () => {
    const [editFile] = buildSessionToolDiffs(
      'edit',
      'completed',
      '{"path":"src/app.ts","oldString":"hello","newString":"world"}'
    );
    const parsedEdit = getSingularPatch(editFile?.patch ?? '');
    expect(parsedEdit.hunks).toHaveLength(1);
    expect(parsedEdit.hunks[0]?.collapsedBefore).toBe(0);
    expect(parsedEdit.hunks[0]?.deletionStart).toBe(1);
    expect(parsedEdit.hunks[0]?.additionStart).toBe(1);

    const [writeFile] = buildSessionToolDiffs(
      'write_file',
      'completed',
      '{"path":"src/new.ts","content":"export const value = 1;\\nexport const other = 2;\\n"}'
    );
    const parsedWrite = getSingularPatch(writeFile?.patch ?? '');
    expect(parsedWrite.type).toBe('new');
    expect(parsedWrite.hunks).toHaveLength(1);
    expect(parsedWrite.hunks[0]?.collapsedBefore).toBe(0);
    expect(parsedWrite.hunks[0]?.deletionStart).toBe(0);
    expect(parsedWrite.hunks[0]?.additionStart).toBe(1);
  });
});
