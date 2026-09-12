import { getSingularPatch } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import { buildSessionToolDiffs } from './session-tool-diff';

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
