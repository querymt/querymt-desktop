export interface RoundIdenticonOptions {
  width?: number;
  size?: number;
  segments?: number;
  symmetricAxisAngle?: number;
}

export interface RoundIdenticon {
  width: number;
  center: number;
  centerRadius: number;
  color: string;
  paths: string[];
}

const DEFAULT_WIDTH = 32;
const DEFAULT_SIZE = 6;
const DEFAULT_SEGMENTS = 10;
const DEFAULT_SYMMETRIC_AXIS_ANGLE = 45;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function createRoundIdenticon(seed: string, options: RoundIdenticonOptions = {}): RoundIdenticon {
  const width = Math.max(1, Math.floor(options.width ?? DEFAULT_WIDTH));
  const size = Math.max(2, Math.floor(options.size ?? DEFAULT_SIZE));
  const segments = options.segments ?? DEFAULT_SEGMENTS;
  const symmetricAxisAngle = options.symmetricAxisAngle ?? DEFAULT_SYMMETRIC_AXIS_ANGLE;
  const hash = hashSeedToHex(seed, Math.max(16, size * 2 + 3));
  const bytes = reverse(byteArray(hash));
  const color = `#${bytes.slice(bytes.length - 3).map(int2ByteString).join('')}`;
  const segmentWidth = Math.floor(width / (size * 2 + 1));
  const center = width / 2;
  const paths: string[] = [];
  const segmentStep = Number.isFinite(segments) && segments > 0 ? 360 / segments : 0;

  for (let i = 1; i < size; ++i) {
    let theta1 = floorToCongruent(360 * (bytes[i * 2] / 0xff), segmentStep);
    let theta2 = floorToCongruent(360 * (bytes[i * 2 + 1] / 0xff), segmentStep);

    if (theta2 < theta1) {
      const temp = theta1;
      theta1 = theta2;
      theta2 = temp;
    }

    paths.push(buildArc(center, center, segmentWidth * i, segmentWidth * (i + 1) + 1, theta1, theta2));

    if (symmetricAxisAngle !== undefined) {
      paths.push(
        buildArc(
          center,
          center,
          segmentWidth * i,
          segmentWidth * (i + 1) + 1,
          symmetricAxisAngle * 2 - theta2,
          symmetricAxisAngle * 2 - theta1
        )
      );
    }
  }

  return {
    width,
    center,
    centerRadius: segmentWidth + 1,
    color,
    paths
  };
}

function hashSeedToHex(seed: string, byteLength: number): string {
  const source = seed || 'session';
  const wordCount = Math.ceil(byteLength / 4);
  const words: string[] = [];

  for (let wordIndex = 0; wordIndex < wordCount; ++wordIndex) {
    const wordHash = fnv1a(`${wordIndex}:${source}`, FNV_OFFSET ^ Math.imul(wordIndex + 1, 0x9e3779b1));
    words.push(wordHash.toString(16).padStart(8, '0'));
  }

  return words.join('').slice(0, byteLength * 2);
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;

  for (let i = 0; i < input.length; ++i) {
    const code = input.charCodeAt(i);
    hash ^= code & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
    hash ^= code >>> 8;
    hash = Math.imul(hash, FNV_PRIME);
  }

  hash ^= input.length;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function byteArray(hash: string): number[] {
  const bytes: number[] = [];

  for (let i = 0; i < hash.length / 2; ++i) {
    const byteIndex = hash.length - (i + 1) * 2;
    bytes.push(Number.parseInt(hash.slice(byteIndex, byteIndex + 2), 16));
  }

  return bytes;
}

function int2ByteString(n: number): string {
  return (`0${n.toString(16)}`).slice(-2);
}

function polar(r: number, theta: number): { x: number; y: number } {
  return {
    x: r * Math.cos((Math.PI * (theta - 90)) / 180),
    y: r * Math.sin((Math.PI * (theta - 90)) / 180)
  };
}

function reverse<T>(arr: T[]): T[] {
  const newArr = new Array<T>(arr.length);

  for (let i = 0; i < arr.length; ++i) {
    newArr[arr.length - i - 1] = arr[i];
  }

  return newArr;
}

function buildArc(cx: number, cy: number, r1: number, r2: number, theta1: number, theta2: number): string {
  const largeArcFlag = theta2 - theta1 < 180 ? 0 : 1;
  const points = [polar(r2, theta1), polar(r2, theta2), polar(r1, theta2), polar(r1, theta1)];

  return (
    `M ${cx + points[0].x} ${cy + points[0].y} ` +
    `A ${r2} ${r2} 0 ${largeArcFlag} 1 ${cx + points[1].x} ${cy + points[1].y} ` +
    `L ${cx + points[2].x} ${cy + points[2].y} ` +
    `A ${r1} ${r1} 0 ${largeArcFlag} 0 ${cx + points[3].x} ${cy + points[3].y} ` +
    'Z'
  );
}

function floorToCongruent(n: number, m: number): number {
  if (!m) {
    return n;
  }

  return Math.floor(n / m) * m;
}
