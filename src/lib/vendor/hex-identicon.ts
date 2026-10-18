const PALETTE = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#F97316'
] as const;

function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashBytes(seed: string, n = 16): Uint8Array {
  const out = new Uint8Array(n);
  let h = fnv1a(seed);
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    out[i] = (h >>> 16) & 0xff;
  }
  return out;
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export interface HexIdenticonOptions {
  size?: number;
  rings?: number;
  density?: number;
  hexRadius?: number;
}

export function createHexIdenticon(seed: string, opts: HexIdenticonOptions = {}): string {
  const size = opts.size ?? 40;
  const rings = opts.rings ?? 2;
  const density = opts.density ?? 0.5;
  const hexR = opts.hexRadius ?? size * 0.082;

  const bytes = hashBytes(seed);
  const cx = size / 2;
  const cy = size / 2;
  const spacing = hexR * 2.05;

  const colorCount = (bytes[0] % 2) + 1;
  const colors: string[] = [];
  for (let i = 0; i < colorCount; i++) {
    colors.push(PALETTE[(bytes[1 + i] + i * 3) % PALETTE.length]);
  }

  const positions: [number, number][] = [[cx, cy]];
  for (let ri = 1; ri <= rings; ri++) {
    const count = 6 * ri;
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count;
      positions.push([
        cx + spacing * ri * Math.cos(ang),
        cy + spacing * ri * Math.sin(ang)
      ]);
    }
  }

  const filled: { x: number; y: number; c: string }[] = [];
  for (let i = 0; i < positions.length; i++) {
    const [x, y] = positions[i];
    const b = bytes[i % bytes.length];
    const thresh = Math.floor(255 * (1 - density)) + Math.floor(i / 6) * 12;
    if (i === 0 || b > thresh) {
      filled.push({ x, y, c: colors[b % colors.length] });
    }
  }

  const final = new Map<string, { x: number; y: number; c: string }>();
  for (const p of filled) {
    const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    final.set(key, p);
    if (Math.abs(p.x - cx) > 0.5) {
      const mx = 2 * cx - p.x;
      const mkey = `${mx.toFixed(1)},${p.y.toFixed(1)}`;
      final.set(mkey, { x: mx, y: p.y, c: p.c });
    }
  }

  const polygons = Array.from(final.values())
    .map((p) => `<polygon points="${hexPoints(p.x, p.y, hexR)}" fill="${p.c}"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">${polygons}</svg>`;
}
