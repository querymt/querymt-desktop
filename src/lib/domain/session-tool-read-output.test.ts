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
    expect(lines[0]).toEqual({ lineNumber: '00141', text: '     use kameo::error::RemoteSendError;' });
    expect(lines[1]).toEqual({ lineNumber: '00142', text: '' });
    expect(lines[3]).toEqual({
      lineNumber: '00144',
      text: '         RemoteSendError::ActorNotRunning | RemoteSendError::ActorStopped => {'
    });
  });

  it('keeps the rest of the line intact when the content itself contains pipes', () => {
    const view = parseReadFileOutput(
      '<path>run.sh</path>\n<type>file</type>\n<content>\n00001| echo "a|b" | wc -l\n</content>'
    );
    expect(view!.sections[0]!.lines[0]).toEqual({ lineNumber: '00001', text: ' echo "a|b" | wc -l' });
    expect(view!.truncated).toBe(false);
  });

  it('parses directory listings and keeps unnumbered note lines', () => {
    const view = parseReadFileOutput(
      '<path>src/lib</path>\n<type>directory</type>\n<content>\n00000| 0 components/\n00001| 1 mesh/\n</content>'
    );
    expect(view!.type).toBe('directory');
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00000', text: ' 0 components/' },
      { lineNumber: '00001', text: ' 1 mesh/' }
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
      { lineNumber: '00010', text: ' | col1 | col2 |' },
      { lineNumber: '00011', text: ' |---|---|' }
    ]);
  });

  it('keeps gutter-less lines containing pipes as plain text rows', () => {
    const view = parseReadFileOutput(
      '<path>run.sh</path>\n<type>file</type>\n<content>\n00001| echo hi\nnote with a|b pipe\n</content>'
    );
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00001', text: ' echo hi' },
      { lineNumber: null, text: 'note with a|b pipe' }
    ]);
  });

  it('normalizes CRLF line endings in tagged content', () => {
    const view = parseReadFileOutput(
      '<path>a.rs</path>\r\n<type>file</type>\r\n<content>\r\n00001| fn a() {}\r\n00002| }\r\n</content>'
    );
    expect(view!.sections[0]!.lines).toEqual([
      { lineNumber: '00001', text: ' fn a() {}' },
      { lineNumber: '00002', text: ' }' }
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
      { lineNumber: '00001', text: ' const open = "<content>";' },
      { lineNumber: '00002', text: ' const close = "</content>";' }
    ]);
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
    expect(lines[1]).toEqual({ lineNumber: '00001', text: ' fn alpha() {' });
    expect(lines[3]).toEqual({ lineNumber: '00003', text: ' }' });
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
    expect(lines[1]).toEqual({ lineNumber: '00001', text: ' struct Config;' });
    expect(lines[4]).toEqual({ lineNumber: null, text: '- Failed to index file: unsupported' });
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

describe('parseReadFileOutput: fallbacks', () => {
  it('returns null for non read-tool output', () => {
    expect(parseReadFileOutput(null)).toBeNull();
    expect(parseReadFileOutput('')).toBeNull();
    expect(parseReadFileOutput('OK src/app.ts updated')).toBeNull();
    expect(parseReadFileOutput('<path>README.md</path>\nno content block')).toBeNull();
  });
});
