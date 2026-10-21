import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('left rail shape morph', () => {
  it('preserves the navigation icons circle-to-squircle morph and subtle lift', () => {
    expect(appCss).toContain('--rail-item-radius-rest: 999px;');
    expect(appCss).toContain('--rail-item-radius-hover: 14px;');
    expect(appCss).toContain('--rail-item-morph-duration: 180ms;');
    expect(appCss).toContain('width: 2.4rem;\n  height: 2.4rem;');
    expect(appCss).toContain('border-radius: var(--rail-item-radius-hover);');

    const hoverRule = appCss.match(/\.app-icon-link:hover,\n\.app-icon-link:focus-visible \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(hoverRule).toContain('transform: translateY(-1px);');
    expect(hoverRule).not.toContain('scale(');
  });

  it('keeps session identicons unframed while retaining feedback on their clickable target', () => {
    for (const selector of ['session-icon-avatar', 'app-sidebar-session-avatar', 'session-row-identicon', 'session-workspace-icon']) {
      const rule = appCss.match(new RegExp(`^\\.${selector} \\{([\\s\\S]*?)\\}`, 'm'))?.[1];
      expect(rule).toBeDefined();
      expect(rule).not.toMatch(/border:|box-shadow:|background:/);
    }
    expect(appCss).not.toContain('.session-icon-link-active .session-icon-avatar');
    const hoverRule = appCss.match(/\.session-icon-link:hover,\n\.session-icon-link:focus-visible \{([\s\S]*?)\}/)?.[1];
    expect(hoverRule).toContain('background: var(--row-surface-hover);');
    expect(hoverRule).not.toMatch(/transform:|box-shadow:/);
    const focusRule = appCss.match(/\n\n\.session-icon-link:focus-visible \{([\s\S]*?)\}/)?.[1];
    expect(focusRule).toContain('outline: 2px solid var(--accent);');
  });

  it('does not persistently highlight active session rows or add an activity pill', () => {
    expect(appCss).not.toContain('.app-sidebar-session-active');
    expect(appCss).not.toContain('.session-icon-link-active');
    expect(appCss).not.toContain('.session-icon-link:hover .app-icon-activity-pill');
    expect(appCss).toContain('.app-icon-link-current .app-icon-activity-pill');
  });

  it('does not reserve idle row space for session actions or number badges', () => {
    const entry = appCss.match(/\n\.session-rail-entry \{([\s\S]*?)\}/)?.[1];
    expect(entry).not.toContain('grid-template-columns');
    const row = appCss.match(/\n\.app-sidebar-session \{([\s\S]*?)\}/)?.[1];
    expect(row).toContain('grid-template-columns: 1.75rem minmax(0, 1fr);');
    expect(row).toContain('padding: 0.38rem 0.45rem;');
    const trigger = appCss.match(/\.session-rail-entry:not\(\.session-rail-entry-compact\) > \.session-row-menu-trigger \{([\s\S]*?)\}/)?.[1];
    expect(trigger).toContain('position: absolute;');
    const hidden = appCss.match(/\.session-rail-entry > \.session-row-menu-trigger \{([\s\S]*?)\}/)?.[1];
    expect(hidden).toContain('opacity: 0;');
    expect(hidden).toContain('pointer-events: none;');
    expect(appCss).not.toContain('.app-sidebar-session kbd');
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
