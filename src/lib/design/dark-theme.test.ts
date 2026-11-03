import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
const darkTheme = appCss.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('dark theme palette', () => {
  it('uses a solid neutral base with progressively lighter surfaces', () => {
    expect(darkTheme).toContain('--bg: #1b1b1b;');
    expect(darkTheme).toContain('--body-bg-base: #1b1b1b;');
    expect(darkTheme).toContain('--body-bg-image: none;');
    expect(darkTheme).toContain('--bg-surface: #202020;');
    expect(darkTheme).toContain('--bg-panel: #232323;');
    expect(darkTheme).toContain('--bg-panel-strong: #272727;');
    expect(darkTheme).toContain('--bg-card: #292929;');
    expect(darkTheme).toContain('--bg-card-hover: #303030;');
  });

  it('keeps navigation and recessed surfaces neutral and solid', () => {
    expect(darkTheme).toContain('--nav-bg: #202020;');
    expect(darkTheme).toContain('--surface-blur: none;');
    expect(darkTheme).toContain('--recessed-surface: #181818;');
    expect(darkTheme).toContain('--code-bg: #1b1b1b;');
  });

  it('keeps passive panels quiet and the composer border constant on hover', () => {
    const panelStrong = appCss.match(/\.panel-strong \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const composer = appCss.match(/\.session-composer-dock-expanded \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(panelStrong).not.toContain('transition: border-color');
    expect(appCss).not.toContain('.panel:hover,');
    // The composer border does not change on hover or focus; it gets a static inset highlight instead.
    expect(appCss).not.toContain('.session-composer-dock-expanded:hover');
    expect(composer).toContain('inset 0 1px 0 rgba(255, 255, 255, 0.04)');
  });

  it('uses diff-addition green only for the resolved header icon', () => {
    const resolved = appCss.match(/\.session-header-lifecycle-icon-resolved \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const added = appCss.match(/\.session-tool-change-added \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(resolved.trim()).toBe(added.trim());
    expect(resolved).toContain('color: var(--status-success);');
    const lifecycle = appCss.match(/\.session-header-lifecycle \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(lifecycle).toContain('color: var(--muted);');
    expect(lifecycle).not.toMatch(/border:|background:|box-shadow:/);
    const mobileMetadata = appCss.match(/\.session-header-mobile-meta \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobileMetadata).toContain('min-height: 13px;');
  });

  it('centers workspace create controls and reserves fixed date columns', () => {
    // Check every occurrence so a later duplicate cannot undo the layout.
    const rules = (selector: string) => [...appCss.matchAll(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]+)\\}`, 'g'))].map((match) => match[1]);
    const createButtons = rules('.session-workspace-new');
    expect(createButtons.length).toBeGreaterThan(0);
    for (const rule of createButtons) {
      expect(rule).toContain('top: 50%;');
      expect(rule).toContain('transform: translateY(-50%);');
    }
    const dates = [
      ...rules('.session-workspace-updated').filter((rule) => rule.includes('font-variant-numeric')),
      ...rules('.session-row-side > .session-row-timestamp')
    ];
    expect(dates.length).toBeGreaterThanOrEqual(2);
    for (const rule of dates) {
      expect(rule).toContain('width: 6rem;');
      expect(rule).toContain('flex: 0 0 6rem;');
    }
  });

  it('keeps workspace folders unframed and loading controls neutral', () => {
    const workspaceIcon = appCss.match(/\.session-workspace-icon \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const loadMore = appCss.match(/\.session-workspace-load-more \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(workspaceIcon).not.toMatch(/background:|border:|box-shadow:/);
    expect(workspaceIcon).toContain('color: var(--text-muted);');
    expect(loadMore).toContain('background: transparent;');
    expect(loadMore).toContain('color: var(--text-dim);');
  });
});
