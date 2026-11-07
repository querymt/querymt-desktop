import { describe, expect, it } from 'vitest';
import { BOOT_MARK_LINKS, BOOT_MARK_NODES } from './boot-mark';

describe('boot mark geometry', () => {
  it('has the seven Q hexagons and eleven framing peers (the tail fills the twelfth slot)', () => {
    expect(BOOT_MARK_NODES.filter((node) => node.isLogo)).toHaveLength(7);
    expect(BOOT_MARK_NODES.filter((node) => !node.isLogo)).toHaveLength(11);
  });

  it('links only neighbouring hexagons', () => {
    expect(BOOT_MARK_LINKS.length).toBeGreaterThan(0);
    for (const link of BOOT_MARK_LINKS) {
      expect(link.length).toBeLessThan(65);
      expect(link.delay).toBeGreaterThan(Math.max(link.a.delay, link.b.delay));
    }
  });

  it('keeps the Q counter empty', () => {
    expect(BOOT_MARK_NODES.some((node) => Math.hypot(node.x, node.y) < 1)).toBe(false);
  });
});
