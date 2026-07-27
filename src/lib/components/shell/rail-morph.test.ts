import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('left rail shape morph', () => {
  it('morphs fixed-size rail layers from circles to soft squircles with a subtle lift', () => {
    expect(appCss).toContain('--rail-item-radius-rest: 999px;');
    expect(appCss).toContain('--rail-item-radius-hover: 14px;');
    expect(appCss).toContain('--rail-item-morph-duration: 180ms;');
    expect(appCss).toContain('width: 2.4rem;\n  height: 2.4rem;');
    expect(appCss).toContain('border-radius: var(--rail-item-radius-hover);');

    const hoverRule = appCss.match(/\.app-icon-link:hover,[\s\S]*?\.session-icon-link:focus-visible \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(hoverRule).toContain('transform: translateY(-1px);');
    expect(hoverRule).not.toContain('scale(');
  });

  it('disables every visible rail-layer transition for reduced motion', () => {
    const reducedMotionRule = appCss.match(/@media \(prefers-reduced-motion: reduce\) \{\n  \.app-sidebar,([\s\S]*?)\n\}/)?.[0] ?? '';
    expect(reducedMotionRule).toContain('.app-sidebar');
    expect(reducedMotionRule).toContain('.app-icon-link');
    expect(reducedMotionRule).toContain('.session-icon-link');
    expect(reducedMotionRule).toContain('.app-nav-icon-surface');
    expect(reducedMotionRule).toContain('.session-icon-surface');
    expect(reducedMotionRule).toContain('.session-icon-avatar');
    expect(reducedMotionRule).toContain('transition: none;');
  });
});
