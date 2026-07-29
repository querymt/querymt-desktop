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

  it('keeps passive panels quiet while the composer retains a subtle hover highlight', () => {
    const panelStrong = appCss.match(/\.panel-strong \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const composerHover = appCss.match(/\.session-composer-dock-expanded:hover \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(panelStrong).not.toContain('transition: border-color');
    expect(appCss).not.toContain('.panel:hover,');
    expect(composerHover).toContain('border-color: color-mix(in srgb, var(--border), var(--border-strong) 42%);');
  });

  it('gives workspace affordances distinct but neutral contrast', () => {
    const workspaceIcon = appCss.match(/\.session-workspace-icon \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const loadMore = appCss.match(/\.session-workspace-load-more \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(workspaceIcon).toContain('background: var(--icon-surface);');
    expect(workspaceIcon).toContain('border: 1px solid var(--subtle-border);');
    expect(workspaceIcon).toContain('color: var(--text-muted);');
    expect(loadMore).toContain('width: 100%;');
    expect(loadMore).toContain('background: var(--subtle-surface);');
    expect(loadMore).toContain('color: var(--text-muted);');
  });
});
