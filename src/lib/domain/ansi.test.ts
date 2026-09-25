import { describe, expect, it } from 'vitest';
import { parseAnsiLines } from './ansi';

describe('parseAnsiLines', () => {
  it('returns a single unstyled segment for plain text', () => {
    expect(parseAnsiLines('hello world')).toEqual([
      { segments: [{ text: 'hello world', bold: false, dim: false, italic: false, underline: false }] }
    ]);
  });

  it('applies foreground colors and text styles', () => {
    const [line] = parseAnsiLines('\x1b[31mred\x1b[1mbold red\x1b[0m plain');
    expect(line).not.toBeUndefined();
    expect(line!.segments).toHaveLength(3);
    expect(line!.segments[0]).toMatchObject({ text: 'red', fg: '#cd3131' });
    expect(line!.segments[1]).toMatchObject({ text: 'bold red', fg: '#cd3131', bold: true });
    expect(line!.segments[2]).toMatchObject({ text: ' plain', fg: undefined, bold: false });
  });

  it('supports bright colors, backgrounds, italic, underline, and dim', () => {
    const [line] = parseAnsiLines('\x1b[91;44mbright\x1b[3;4mitalic underline\x1b[24m\x1b[2mdim\x1b[0m');
    expect(line!.segments[0]).toMatchObject({ text: 'bright', fg: '#f14c4c', bg: '#2472c8' });
    expect(line!.segments[1]).toMatchObject({ text: 'italic underline', italic: true, underline: true });
    expect(line!.segments[2]).toMatchObject({ text: 'dim', underline: false, dim: true, italic: true });
  });

  it('supports 256-color and truecolor codes for foreground and background', () => {
    const [line] = parseAnsiLines('\x1b[38;5;208morange\x1b[48;2;12;34;56mtrue\x1b[0m');
    expect(line!.segments[0]).toMatchObject({ text: 'orange', fg: 'rgb(255, 135, 0)' });
    expect(line!.segments[1]).toMatchObject({ text: 'true', bg: 'rgb(12, 34, 56)' });
  });

  it('splits styled text across lines and drops the trailing empty line', () => {
    const lines = parseAnsiLines('\x1b[32mone\ntwo\x1b[0m\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.segments).toEqual([{ text: 'one', fg: '#0dbc79', bold: false, dim: false, italic: false, underline: false }]);
    expect(lines[1]!.segments).toEqual([{ text: 'two', fg: '#0dbc79', bold: false, dim: false, italic: false, underline: false }]);
  });

  it('strips cursor movement and OSC sequences entirely', () => {
    const [line] = parseAnsiLines('\x1b[2K\r\x1b]0;window title\x07done\x1b[?25h');
    expect(line!.segments).toHaveLength(1);
    expect(line!.segments[0]!.text).toBe('done');
  });

  it('normalizes carriage returns and empty output', () => {
    expect(parseAnsiLines('progress\r\nfinal')).toEqual([
      { segments: [expect.objectContaining({ text: 'progress' })] },
      { segments: [expect.objectContaining({ text: 'final' })] }
    ]);
    expect(parseAnsiLines('')).toEqual([{ segments: [] }]);
    expect(parseAnsiLines('a\n\nb')).toEqual([
      { segments: [expect.objectContaining({ text: 'a' })] },
      { segments: [] },
      { segments: [expect.objectContaining({ text: 'b' })] }
    ]);
  });

  it('does not split mid-token when a sequence immediately follows text', () => {
    const lines = parseAnsiLines('npm WARN\x1b[33m deprecated\x1b[39m');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments).toHaveLength(2);
    expect(lines[0]!.segments[1]).toMatchObject({ text: ' deprecated', fg: '#e5e510' });
  });
});
