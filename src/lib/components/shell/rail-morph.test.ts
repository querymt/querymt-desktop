import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('flat sidebar rail', () => {
  it('renders the sidebar flat, without a card, border, shadow or blur', () => {
    const sidebar = appCss.match(/\n\.app-sidebar \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(sidebar).toContain('border: 0;');
    expect(sidebar).toContain('background: transparent;');
    expect(sidebar).not.toMatch(/box-shadow:|backdrop-filter:/);
    expect(appCss).not.toContain('.app-sidebar-link-current::before');
  });

  it('floats the expanded sidebar as a bordered card, with quiet zone dividers and a fade', () => {
    const expanded = appCss.match(/\n\.app-sidebar-expanded \{([\s\S]*?)\}/)?.[1] ?? '';
    // Floating card, as before the restyle.
    expect(expanded).toContain('border: 1px solid var(--border);');
    // Same radius and surface as the composer card (.panel-strong).
    const composer = appCss.match(/\n\.panel-strong \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(composer).toContain('border-radius: var(--radius);');
    expect(composer).toContain('background: var(--bg-panel-strong);');
    expect(expanded).toContain('border-radius: var(--radius);');
    expect(expanded).toContain('background: var(--bg-panel-strong);');
    expect(expanded).toContain('box-shadow: var(--shadow-sm);');
    expect(expanded).toContain('width: var(--app-sidebar-expanded-width);');
    // No docking or gradient slope/bevel.
    expect(expanded).not.toMatch(/linear-gradient|100dvh|top: 0;|left: 0;/);
    expect(appCss).not.toContain('--sidebar-slope-');
    expect(appCss).not.toContain('.app-sidebar-expanded::after');
    expect(appCss).not.toContain('--sidebar-bevel-');
    const collapsed = appCss.match(/\n\.app-sidebar-collapsed \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(collapsed).not.toMatch(/background:|border:/);

    for (const selector of ['app-sidebar-recent', 'app-sidebar-footer']) {
      const rule = appCss.match(new RegExp(`\\n\\.${selector} \\{([\\s\\S]*?)\\}`))?.[1] ?? '';
      expect(rule).toContain('border-top: 1px solid var(--subtle-border);');
    }
    const list = appCss.match(/\n\.app-sidebar-session-list \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(list).toContain('mask-image: linear-gradient');
    // The heading selector also appears in a grouped label rule; check the layout rule.
    const headingRules = [...appCss.matchAll(/\n\.app-sidebar-section-heading \{([\s\S]*?)\}/g)].map((m) => m[1]);
    expect(headingRules.some((rule) => rule.includes('position: sticky;') && rule.includes('background: var(--bg-panel-strong);'))).toBe(true);
  });

  it('aligns the sidebar bottom with the composer and reuses that gap above the sidebar', () => {
    const sidebar = appCss.match(/\n\.app-sidebar \{([\s\S]*?)\}/)?.[1] ?? '';
    const composer = appCss.match(/\n\.session-composer-dock \{([\s\S]*?)\}/)?.[1] ?? '';
    for (const rule of [sidebar, composer]) {
      expect(rule).toContain('bottom: var(--session-composer-bottom-offset);');
    }
    expect(sidebar).toContain('top: var(--session-composer-bottom-offset);');
    expect(sidebar).toContain('height: auto;');
    expect(appCss).toContain('top: calc(12px + 2.5rem + var(--session-composer-bottom-offset));');
    expect(appCss).toContain('top: calc(2.5rem + var(--session-composer-bottom-offset));');
  });

  it('uses ghost collapsed icons with a faint hover fill instead of the shape morph', () => {
    expect(appCss).not.toContain('--rail-item-radius');
    expect(appCss).toContain('width: 2.4rem;\n  height: 2.4rem;');

    const hoverRule = appCss.match(/\.app-icon-link:hover,\n\.app-icon-link:focus-visible \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(hoverRule).toContain('background: var(--composer-pill-surface-hover);');
    expect(hoverRule).not.toMatch(/transform:|box-shadow:|border-radius:/);
    const surface = appCss.match(/\n\.app-nav-icon-surface \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(surface).not.toMatch(/border:|box-shadow:|background:/);
  });

  it('keeps the attention dot flat, without a glow', () => {
    const dot = appCss.match(/\n\.sidebar-attention-dot \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(dot).not.toContain('box-shadow');
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
    expect(appCss).not.toContain('.app-icon-activity-pill');
  });

  it('does not reserve idle row space for session actions or number badges', () => {
    const entry = appCss.match(/\n\.session-rail-entry \{([\s\S]*?)\}/)?.[1];
    expect(entry).not.toContain('grid-template-columns');
    const row = appCss.match(/\n\.app-sidebar-session \{([\s\S]*?)\}/)?.[1];
    expect(row).toContain('grid-template-columns: 1rem minmax(0, 1fr) auto;');
    expect(row).toContain('padding: 0.38rem 0.5rem;');
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
