import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createHexIdenticon } from '$lib/vendor/hex-identicon';
import { createRoundIdenticon } from '$lib/vendor/round-identicon';
import Identicon from './Identicon.svelte';

afterEach(cleanup);

describe('hex identicons', () => {
  it('is deterministic and distinguishes session seeds', () => {
    expect(createHexIdenticon('session-a')).toBe(createHexIdenticon('session-a'));
    expect(createHexIdenticon('session-a')).not.toBe(createHexIdenticon('session-b'));
  });

  it('uses at most two fixed palette colors and finite six-point polygons', () => {
    const palette = new Set(['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316']);
    for (const seed of ['', 'session-a', 'session-b', 'delegate-1']) {
      const svg = new DOMParser().parseFromString(createHexIdenticon(seed), 'image/svg+xml');
      const polygons = [...svg.querySelectorAll('polygon')];
      expect(polygons.length).toBeGreaterThan(0);
      const colors = new Set(polygons.map((polygon) => polygon.getAttribute('fill')!));
      expect(colors.size).toBeLessThanOrEqual(2);
      expect([...colors].every((color) => palette.has(color))).toBe(true);
      for (const polygon of polygons) {
        const points = polygon.getAttribute('points')!.split(' ');
        expect(points).toHaveLength(6);
        expect(points.every((point) => point.split(',').every((coordinate) => Number.isFinite(Number(coordinate))))).toBe(true);
      }
    }
  });

  it('does not interpolate the seed into the SVG markup', () => {
    const seed = '<script>alert(1)</script><svg onload="alert(1)">';
    const svg = createHexIdenticon(seed);
    expect(svg).not.toContain(seed);
    expect(svg).not.toMatch(/script|onload|alert/);
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });

  it('renders decorative hex SVGs and updates them when the seed or size changes', async () => {
    const { container, rerender } = render(Identicon, { seed: 'session-a' });
    expect(container.querySelector('.hex-identicon')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 32 32');
    expect(container.querySelector('svg')?.outerHTML).toBe(new DOMParser().parseFromString(createHexIdenticon('session-a', { size: 32 }), 'text/html').querySelector('svg')?.outerHTML);
    await rerender({ seed: 'session-b', size: 48 });
    expect(container.querySelector('svg')?.outerHTML).toBe(new DOMParser().parseFromString(createHexIdenticon('session-b', { size: 48 }), 'text/html').querySelector('svg')?.outerHTML);
  });

  it('retains the round generator as an independent unused option', () => {
    const round = createRoundIdenticon('session-a');
    expect(round).toEqual(createRoundIdenticon('session-a'));
    expect(round.arcs.length).toBeGreaterThan(0);
    expect(round.width).toBe(32);
  });
});
