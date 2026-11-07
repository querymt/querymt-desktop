/**
 * QueryMT boot mark geometry, ported from the mobile app
 * (`querymt-mobile/src/components/startup/connectAnimation.ts`). Keep both in sync
 * if the brand mark changes.
 */

/** Indeterminate indicator timing only; it never controls readiness. */
export const BOOT_MARK_CYCLE_MS = 1800;
/** Same tilt as the app icon (`BrandIcon.svelte`), rotated about the Q's ring centre. */
export const BOOT_MARK_ROTATION = 14.90684242;
export const BOOT_MARK_VIEWBOX = '-164 -164 328 328';

const SPACING = 64;
const ROW = (SPACING * Math.sqrt(3)) / 2;
export const LOGO_HEX_POINTS = '27.2,-15.7 27.2,15.7 0,31.4 -27.2,15.7 -27.2,-15.7 0,-31.4';
export const PEER_HEX_POINTS = '17.3,-10 17.3,10 0,20 -17.3,10 -17.3,-10 0,-20';

const at = (q: number, r: number) => ({ x: SPACING * (q + r / 2), y: ROW * r });

// The icon's seven hexagons: a six-hex ring around an empty counter, plus the tail.
const q = [at(1, -1), at(0, -1), at(-1, 0), at(-1, 1), at(0, 1), at(1, 0), at(1, 1)];

const ring2 = [
  [2, -2], [1, -2], [0, -2], [-1, -1], [-2, 0], [-2, 1],
  [-2, 2], [-1, 2], [0, 2], [1, 1], [2, 0], [2, -1]
].map(([a, b]) => at(a, b));
const tailIndex = ring2.findIndex((p) => Math.hypot(p.x - q[6].x, p.y - q[6].y) < 1);
const peers = [...ring2.slice(tailIndex + 1), ...ring2.slice(0, tailIndex)].reverse();

export interface BootMarkNode {
  x: number;
  y: number;
  points: string;
  isLogo: boolean;
  delay: number;
}

export interface BootMarkLink {
  id: string;
  a: BootMarkNode;
  b: BootMarkNode;
  length: number;
  delay: number;
}

export const BOOT_MARK_NODES: BootMarkNode[] = [
  ...q.map((p, index) => ({ ...p, points: LOGO_HEX_POINTS, isLogo: true, delay: 80 + index * 45 })),
  ...peers.map((p, index) => ({ ...p, points: PEER_HEX_POINTS, isLogo: false, delay: 420 + index * 55 }))
];

export const BOOT_MARK_LINKS: BootMarkLink[] = BOOT_MARK_NODES.flatMap((a, i) =>
  BOOT_MARK_NODES.slice(i + 1).flatMap((b, j) => {
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    return length < 65 ? [{ id: `${i}-${i + j + 1}`, a, b, length, delay: Math.max(a.delay, b.delay) + 120 }] : [];
  })
);
