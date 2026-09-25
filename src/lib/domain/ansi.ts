// Minimal ANSI escape-code parser for rendering shell tool output.
// Supports SGR (colors and text styles) and strips every other escape
// sequence (cursor movement, OSC titles, etc.) so no raw control codes
// leak into the DOM.

export type AnsiSegment = {
  text: string;
  fg?: string;
  bg?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

export type AnsiLine = {
  segments: AnsiSegment[];
};

// VS Code "Dark+" integrated terminal palette.
const PALETTE: Record<number, string> = {
  30: '#666666',
  31: '#cd3131',
  32: '#0dbc79',
  33: '#e5e510',
  34: '#2472c8',
  35: '#bc3fbc',
  36: '#11a8cd',
  37: '#e5e5e5',
  90: '#767676',
  91: '#f14c4c',
  92: '#23d18b',
  93: '#f5f543',
  94: '#3b8eea',
  95: '#d670d6',
  96: '#29b8db',
  97: '#ffffff'
};

type AnsiState = {
  fg?: string;
  bg?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

const ESC = '\x1b';
// CSI sequences: ESC [ <params> <final byte>. OSC sequences: ESC ] ... BEL or ST.
const SEQUENCE_PATTERN = new RegExp(
  `(${ESC}\\[[0-9;:?]*[ -/]*[@-~]|${ESC}\\][^${ESC}]*?(?:${ESC}\\\\|\x07|$))`,
  'g'
);

function colorFrom256(index: number): string {
  if (index < 8) return PALETTE[30 + index];
  if (index < 16) return PALETTE[82 + index];
  if (index < 232) {
    const value = index - 16;
    const blue = value % 6;
    const green = Math.floor(value / 6) % 6;
    const red = Math.floor(value / 36);
    const channel = (steps: number) => (steps === 0 ? 0 : 55 + steps * 40);
    return `rgb(${channel(red)}, ${channel(green)}, ${channel(blue)})`;
  }
  const gray = Math.round(((index - 232) / 23) * 255);
  return `rgb(${gray}, ${gray}, ${gray})`;
}

type StylePatch = Partial<Omit<AnsiState, never>>;

function applySgr(params: string, state: AnsiState, patch: StylePatch): void {
  const codes = params.length === 0 ? [0] : params.split(';').map((code) => Number(code) || 0);

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]!;
    if (code === 0) {
      patch.fg = undefined;
      patch.bg = undefined;
      patch.bold = false;
      patch.dim = false;
      patch.italic = false;
      patch.underline = false;
    } else if (code === 1) {
      patch.bold = true;
    } else if (code === 2) {
      patch.dim = true;
    } else if (code === 3) {
      patch.italic = true;
    } else if (code === 4) {
      patch.underline = true;
    } else if (code === 22) {
      patch.bold = false;
      patch.dim = false;
    } else if (code === 23) {
      patch.italic = false;
    } else if (code === 24) {
      patch.underline = false;
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      patch.fg = PALETTE[code];
    } else if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      let color: string | undefined;
      if (mode === 5) {
        color = colorFrom256(Number(codes[index + 2]) || 0);
        index += 2;
      } else if (mode === 2) {
        const red = Number(codes[index + 2]) || 0;
        const green = Number(codes[index + 3]) || 0;
        const blue = Number(codes[index + 4]) || 0;
        color = `rgb(${red}, ${green}, ${blue})`;
        index += 4;
      }
      if (code === 38) patch.fg = color;
      else patch.bg = color;
    } else if (code === 39) {
      patch.fg = undefined;
    } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      patch.bg = PALETTE[code - 10];
    } else if (code === 49) {
      patch.bg = undefined;
    }
  }
}

function emptyState(): AnsiState {
  return { bold: false, dim: false, italic: false, underline: false };
}

function snapshot(state: AnsiState): AnsiSegment {
  return {
    text: '',
    fg: state.fg,
    bg: state.bg,
    bold: state.bold,
    dim: state.dim,
    italic: state.italic,
    underline: state.underline
  };
}

function isEmptySegment(segment: AnsiSegment): boolean {
  return (
    !segment.text &&
    !segment.fg &&
    !segment.bg &&
    !segment.bold &&
    !segment.dim &&
    !segment.italic &&
    !segment.underline
  );
}

/** Parses terminal output into styled lines with ANSI sequences applied and stripped. */
export function parseAnsiLines(text: string): AnsiLine[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '');
  const lines: AnsiLine[] = [];
  let state = emptyState();
  let current: AnsiSegment[] = [];
  let buffer = '';

  const flushBuffer = () => {
    if (!buffer) return;
    const segment = snapshot(state);
    segment.text = buffer;
    current.push(segment);
    buffer = '';
  };

  const pushLine = () => {
    flushBuffer();
    while (current.length > 0 && isEmptySegment(current[current.length - 1]!)) {
      current.pop();
    }
    lines.push({ segments: current });
    current = [];
  };

  for (const part of normalized.split(SEQUENCE_PATTERN)) {
    if (!part) continue;
    if (part.startsWith(`${ESC}[`)) {
      flushBuffer();
      const finalByte = part.slice(-1);
      if (finalByte === 'm') {
        const patch: StylePatch = {};
        applySgr(part.slice(2, -1), state, patch);
        state = { ...state, ...patch };
      }
      continue;
    }
    if (part.startsWith(`${ESC}]`)) continue;

    const pieces = part.split('\n');
    for (let index = 0; index < pieces.length; index += 1) {
      if (index > 0) pushLine();
      buffer += pieces[index];
    }
  }
  pushLine();

  if (lines.length > 1 && lines[lines.length - 1]!.segments.length === 0) lines.pop();
  return lines;
}
