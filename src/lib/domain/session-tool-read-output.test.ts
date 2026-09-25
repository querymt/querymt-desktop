import { describe, expect, it } from 'vitest';
import { parseReadFileOutput } from './session-tool-read-output';

const TAGGED_SAMPLE = `<path>/Users/wiking/qmt/querymt/crates/querymt-remote/src/provider_transport.rs</path>
<type>file</type>
<content>
00141|     use kameo::error::RemoteSendError;
00142|
00143|     match error {
00144|         RemoteSendError::ActorNotRunning | RemoteSendError::ActorStopped => {
00145|             Ok(LLMError::Transport {
00146|                 kind: TransportErrorKind::ConnectionClosed,
00147|                 message: "remote actor not running".to_string(),
00148|             })
00149|         }
(File has more lines. Use 'offset' parameter to read beyond line 215)
</content>`;

describe('parseReadFileOutput: tagged read_tool shape', () => {
  it('splits line numbers from content and detects truncation', () => {
    const view = parseReadFileOutput(TAGGED_SAMPLE);
    expect(view).not.toBeNull();
    expect(view!.path).toBe('/Users/wiking/qmt/querymt/crates/querymt-remote/src/provider_transport.rs');
    expect(view!.type).toBe('file');
    expect(view!.truncated).toBe(true);
    expect(view!.sections).toHaveLength(1);
    const lines = view!.sections[0]!.lines;
    expect(lines).toHaveLength(9);
    expect(lines[0]).toEqual({ lineNumber: '00141', text: '    use kameo::error::RemoteSendError;' });
    expect(lines[1]).toEqual({ lineNumber: '00142', text: '' });
    expect(lines[3]).toEqual({
      lineNumber: '00144',
      text: '        RemoteSendError::ActorNotRunning | RemoteSendError::ActorStopped => {'
    });
  });

  it('parses the read_shared producer format without adding indentation or a footer row', () => {
    const result = [
      '<path>/tmp/example.ts</path>',
      '<type>file</type>',
      '<content>',
      '00001| const value = 1;',
      '00002|     indented();',
      '00003| ',
      '',
      '(End of file - total 3 lines)',
      '</content>'
    ].join('\n');
    const view = parseReadFileOutput(result);
    expect(view?.truncated).toBe(false);
    expect(view?.sections[0]?.lines).toEqual([
      { lineNumber: '00001', text: 'const value = 1;' },
      { lineNumber: '00002', text: '    indented();' },
      { lineNumber: '00003', text: '' }
    ]);
  });

  it('parses the read_shared directory entries instead of an empty view', () => {
    const result = '<path>/tmp/project</path>\n<type>directory</type>\n<entries>\nsrc/\nREADME.md\n(2 entries)\n</entries>';
    expect(parseReadFileOutput(result)).toMatchObject({
      type: 'directory',
      sections: [{ lines: [
        { lineNumber: null, text: 'src/' },
        { lineNumber: null, text: 'README.md' },
        { lineNumber: null, text: '(2 entries)' }
      ] }]
    });
  });

  it('keeps the rest of the line intact when the content itself contains pipes', () => {
    const view = parseReadFileOutput(
      '<path>run.sh</path>\n<type>file</type>\n<content>\n00001| echo "a|b" | wc -l\n</content>'
    );
    expect(view!.sections[0]!.lines[0]).toEqual({ lineNumber: '00001', text: 'echo "a|b" | wc -l' });
    expect(view!.truncated).toBe(false);
  });

  it('parses directory listings and keeps unnumbered note lines', () => {
    const view = parseReadFileOutput(
      '<path>src/lib</path>\n<type>directory</type>\n<content>\n00000| 0 components/\n00001| 1 mesh/\n</content>'
    );
    expect(view!.type).toBe('directory');
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00000', text: '0 components/' },
      { lineNumber: '00001', text: '1 mesh/' }
    ]);
  });

  it('trims a trailing newline before the closing content tag', () => {
    const view = parseReadFileOutput('<path>a.ts</path>\n<type>file</type>\n<content>\n00001| const a = 1;\n\n</content>');
    expect(view!.sections[0]!.lines).toHaveLength(1);
  });

  it('keeps markdown table rows intact instead of producing broken gutters', () => {
    const view = parseReadFileOutput(
      '<path>README.md</path>\n<type>file</type>\n<content>\n00010| | col1 | col2 |\n00011| |---|---|\n</content>'
    );
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00010', text: '| col1 | col2 |' },
      { lineNumber: '00011', text: '|---|---|' }
    ]);
  });

  it('keeps gutter-less lines containing pipes as plain text rows', () => {
    const view = parseReadFileOutput(
      '<path>run.sh</path>\n<type>file</type>\n<content>\n00001| echo hi\nnote with a|b pipe\n</content>'
    );
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00001', text: 'echo hi' },
      { lineNumber: null, text: 'note with a|b pipe' }
    ]);
  });

  it('normalizes CRLF line endings in tagged content', () => {
    const view = parseReadFileOutput(
      '<path>a.rs</path>\r\n<type>file</type>\r\n<content>\r\n00001| fn a() {}\r\n00002| }\r\n</content>'
    );
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00001', text: 'fn a() {}' },
      { lineNumber: '00002', text: '}' }
    ]);
  });

  it('reads header tags only from the region before the content block', () => {
    const view = parseReadFileOutput(
      [
        '<path>doc.md</path>',
        '<type>file</type>',
        '<content>',
        '00001| <path>inner/example</path>',
        '00002| <type>file</type>',
        '</content>'
      ].join('\n')
    );
    expect(view!.path).toBe('doc.md');
    expect(view!.type).toBe('file');
    expect(view!.sections[0]!.lines).toHaveLength(2);
  });

  it('keeps content that itself contains content tags intact', () => {
    const view = parseReadFileOutput(
      [
        '<path>parser.ts</path>',
        '<type>file</type>',
        '<content>',
        '00001| const open = "<content>";',
        '00002| const close = "</content>";',
        '</content>'
      ].join('\n')
    );
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00001', text: 'const open = "<content>";' },
      { lineNumber: '00002', text: 'const close = "</content>";' }
    ]);
  });
  it('returns null when the content block never closes', () => {
    expect(parseReadFileOutput('<path>a.ts</path>\n<type>file</type>\n<content>\n00001| const a = 1;')).toBeNull();
  });
});

describe('parseReadFileOutput: untagged get_function/get_symbol shape', () => {
  it('parses a single-file get_function result with metadata headers', () => {
    const result = [
      '/tmp/project/lib.rs',
      '- alpha [1-3] hash=abc123 bytes=42 lines=3',
      '00001| fn alpha() {',
      '00002|     println!("a");',
      '00003| }'
    ].join('\n');
    const view = parseReadFileOutput(result);

    expect(view).not.toBeNull();
    expect(view!.path).toBe('/tmp/project/lib.rs');
    expect(view!.type).toBe('file');
    expect(view!.truncated).toBe(false);
    expect(view!.sections).toHaveLength(1);
    const lines = view!.sections[0]!.lines;
    expect(lines[0]).toEqual({ lineNumber: null, text: '- alpha [1-3] hash=abc123 bytes=42 lines=3' });
    expect(lines[1]).toEqual({ lineNumber: '00001', text: 'fn alpha() {' });
    expect(lines[3]).toEqual({ lineNumber: '00003', text: '}' });
  });

  it('parses multi-file results into sections separated by blank lines', () => {
    const result = [
      '/tmp/project/a.rs',
      '- alpha [1-2] hash=a bytes=8 lines=2',
      '00001| fn alpha() {',
      '00002|     1',
      '00003| }',
      '',
      '/tmp/project/b.rs',
      '- beta [1-1] hash=b bytes=9 lines=1',
      '00001| fn beta() {}'
    ].join('\n');
    const view = parseReadFileOutput(result);

    expect(view!.sections).toHaveLength(2);
    expect(view!.path).toBe('/tmp/project/a.rs');
    expect(view!.sections[0]!.path).toBe('/tmp/project/a.rs');
    expect(view!.sections[0]!.lines.map((line) => line.text.trim())).toEqual([
      '- alpha [1-2] hash=a bytes=8 lines=2',
      'fn alpha() {',
      '1',
      '}'
    ]);
    expect(view!.sections[1]!.path).toBe('/tmp/project/b.rs');
    expect(view!.sections[1]!.lines).toHaveLength(2);
  });

  it('parses get_symbol results with kind metadata and failure notes', () => {
    const result = [
      '/tmp/project/config.rs',
      '- Config kind=struct [1-5] hash=k1 bytes=60 lines=5',
      '00001| struct Config;',
      '00002|',
      '00003| impl Config {',
      '- Failed to index file: unsupported',
      ''
    ].join('\n');
    const view = parseReadFileOutput(result);

    expect(view!.sections).toHaveLength(1);
    const lines = view!.sections[0]!.lines;
    expect(lines[0]).toEqual({ lineNumber: null, text: '- Config kind=struct [1-5] hash=k1 bytes=60 lines=5' });
    expect(lines[1]).toEqual({ lineNumber: '00001', text: 'struct Config;' });
    expect(lines[4]).toEqual({ lineNumber: null, text: '- Failed to index file: unsupported' });
  });

  it('parses drive-letter and UNC path headers', () => {
    const windows = ['C:\\tmp\\project\\lib.rs', '- alpha [1-1] hash=a bytes=8 lines=1', '00001| fn alpha() {}'].join('\n');
    expect(parseReadFileOutput(windows)!.path).toBe('C:\\tmp\\project\\lib.rs');
    const unc = ['\\\\server\\share\\project\\lib.rs', '- alpha [1-1] hash=a bytes=8 lines=1', '00001| fn alpha() {}'].join('\n');
    expect(parseReadFileOutput(unc)!.path).toBe('\\\\server\\share\\project\\lib.rs');
  });

  it('returns null for results without numbered code rows', () => {
    const missing = ['/tmp/project/lib.rs', "- No function named 'missing' found. Available candidates: alpha"].join('\n');
    expect(parseReadFileOutput(missing)).toBeNull();
  });

  it('returns null for text that does not start with a path header', () => {
    expect(parseReadFileOutput('OK src/app.ts updated')).toBeNull();
    expect(parseReadFileOutput('00001| rogue numbered line')).toBeNull();
  });
});

describe('parseReadFileOutput: JSON-wrapped symbol and function results', () => {
  it('parses source in per-file JSON records while preserving numbered lines and pipes', () => {
    const view = parseReadFileOutput(JSON.stringify({
      results: [
        { path: 'src/one.ts', content: '00011| const a = "a|b";\n00012|\n' },
        { path: 'src/two.rs', output: '00020| fn two() {}' }
      ]
    }));
    expect(view?.sections).toHaveLength(2);
    expect(view?.sections[0]?.lines).toEqual([
      { lineNumber: '00011', text: 'const a = "a|b";' },
      { lineNumber: '00012', text: '' }
    ]);
    expect(view?.sections[1]?.path).toBe('src/two.rs');
    expect(view?.sections[1]?.lines[0]).toEqual({ lineNumber: '00020', text: 'fn two() {}' });
  });

  it('parses a JSON-wrapped tagged read and source keyed by a file path', () => {
    expect(parseReadFileOutput(JSON.stringify({ result: TAGGED_SAMPLE }))?.sections[0]?.lines[0]?.lineNumber).toBe('00141');
    const view = parseReadFileOutput(JSON.stringify({ '/tmp/a.rs': '00001| fn a() {}' }));
    expect(view?.path).toBe('/tmp/a.rs');
    expect(view?.sections[0]?.lines[0]?.text).toBe('fn a() {}');
  });

  it('uses the supplied file path for JSON containing only numbered output', () => {
    const view = parseReadFileOutput(JSON.stringify({ content: '00004| const n = 1;   \n00005| next' }), 'src/a.ts');
    expect(view?.sections[0]?.lines[0]).toEqual({ lineNumber: '00004', text: 'const n = 1;   ' });
    expect(parseReadFileOutput('{"unexpected":true}', 'src/a.ts')).toBeNull();
  });

  it('unwraps nested JSON source and detects truncation', () => {
    const output = JSON.stringify({ path: 'src/app.ts', source: '00001| const a = 1;\n(File has more lines. Use offset)' });
    const view = parseReadFileOutput(JSON.stringify({ result: output }));
    expect(view?.truncated).toBe(true);
    expect(view?.sections[0]?.lines).toEqual([{ lineNumber: '00001', text: 'const a = 1;' }]);
  });

  it('parses JSON-wrapped get_function text with file metadata', () => {
    const output = '/tmp/a.rs\n- alpha [7-8] hash=abc bytes=16 lines=2\n00007| fn alpha() {\n00008| }';
    const view = parseReadFileOutput(JSON.stringify({ result: { text: output } }));
    expect(view?.path).toBe('/tmp/a.rs');
    expect(view?.sections[0]?.lines[1]).toEqual({ lineNumber: '00007', text: 'fn alpha() {' });
  });
});

describe('parseReadFileOutput: fallbacks', () => {
  it('returns null for non read-tool output', () => {
    expect(parseReadFileOutput(null)).toBeNull();
    expect(parseReadFileOutput('')).toBeNull();
    expect(parseReadFileOutput('OK src/app.ts updated')).toBeNull();
    expect(parseReadFileOutput('<path>README.md</path>\nno content block')).toBeNull();
  });
});
