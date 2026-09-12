import { marked } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import { normalizeMarkdownCodeFences, renderMarkdownToHtml, splitStreamingMarkdown } from './markdown';

describe('renderMarkdownToHtml', () => {
  it('keeps mermaid fences as language-tagged code blocks', () => {
    const html = renderMarkdownToHtml('```mermaid\nflowchart TD\n  A-->B\n```');

    expect(html).toContain('code-block-shell');
    expect(html).toContain('language-mermaid');
    expect(html).toContain('flowchart TD');
    expect(html).not.toContain('<svg');
  });

  it('wraps fenced code in a constrained code-block shell', () => {
    const html = renderMarkdownToHtml('```ts\nconst value = "hello";\n```');

    expect(html).toContain('code-block-shell');
    expect(html).toContain('code-block-header');
    expect(html).toContain('data-code-copy');
    expect(html).toContain('language-ts');
    expect(html).toContain('const value =');
    expect(html).not.toContain('tok-keyword');
  });

  it('reorders lines-first fence meta as path:start-end', () => {
    const html = renderMarkdownToHtml(
      '```496:499:crates/agent/src/api/agent.rs\nlet value = 1;\n```'
    );

    expect(html).toContain('>crates/agent/src/api/agent.rs:496-499</span>');
  });

  it('reorders single-line fence meta as path:start', () => {
    const html = renderMarkdownToHtml('```12:src/lib/main.rs\nfn main() {}\n```');

    expect(html).toContain('>src/lib/main.rs:12</span>');
  });

  it('keeps path-first fence meta unchanged', () => {
    const html = renderMarkdownToHtml('```src/lib/main.rs:12:14\nfn main() {}\n```');

    expect(html).toContain('>src/lib/main.rs:12:14</span>');
  });

  it('escapes raw html outside and inside code blocks', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>\n\n```html\n<div>bad</div>\n```');

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('code-block-shell');
    expect(html).toContain('&lt;div&gt;bad&lt;/div&gt;');
  });

  it('renders gfm tables', () => {
    const html = renderMarkdownToHtml('| Name | Value |\n| --- | --- |\n| foo | bar |');

    expect(html).toContain('markdown-table-wrap');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('foo');
    expect(html).toContain('bar');
  });

  it('parses identical sources only once', () => {
    const source = `**hello** ${Date.now()}`;
    const spy = vi.spyOn(marked, 'parse');
    renderMarkdownToHtml(source);
    const calls = spy.mock.calls.length;
    const first = renderMarkdownToHtml(source);
    const second = renderMarkdownToHtml(source);

    expect(spy.mock.calls.length).toBe(calls);
    expect(second).toBe(first);
    expect(first).toContain('hello');
    spy.mockRestore();
  });

  it('re-parses when the source changes', () => {
    const first = renderMarkdownToHtml('first');
    const second = renderMarkdownToHtml('second');

    expect(first).not.toBe(second);
    expect(first).toContain('first');
    expect(second).toContain('second');
  });
});

describe('splitStreamingMarkdown', () => {
  it('keeps a single open line as tail text', () => {
    expect(splitStreamingMarkdown('Hello wo')).toEqual({
      frozenHtml: '',
      tailText: 'Hello wo'
    });
  });

  it('freezes completed lines and reuses frozen html while the tail grows', () => {
    const first = splitStreamingMarkdown('# Title\n\nHello wo');
    const second = splitStreamingMarkdown('# Title\n\nHello world');

    expect(first.frozenHtml).toContain('Title');
    expect(first.frozenHtml).not.toContain('Hello wo');
    expect(first.tailText).toBe('Hello wo');
    expect(second.tailText).toBe('Hello world');
    expect(second.frozenHtml).toBe(first.frozenHtml);
  });

  it('does not parse an unclosed fence into a code block', () => {
    const parts = splitStreamingMarkdown('See this:\n\n```ts\nconst value = 1');

    expect(parts.frozenHtml).toContain('See this:');
    expect(parts.frozenHtml).not.toContain('code-block-shell');
    expect(parts.tailText).toContain('```ts');
    expect(parts.tailText).toContain('const value = 1');
  });

  it('does not close a longer fence on a nested shorter delimiter', () => {
    const parts = splitStreamingMarkdown('See this:\n\n````md\n```\ninner\n\nafter inner');

    expect(parts.frozenHtml).toContain('See this:');
    expect(parts.frozenHtml).not.toContain('code-block-shell');
    expect(parts.frozenHtml).not.toContain('after inner');
    expect(parts.tailText).toContain('````md');
    expect(parts.tailText).toContain('after inner');
  });

  it('keeps an unclosed tilde fence in the tail even when it contains a blank line', () => {
    const parts = splitStreamingMarkdown('See this:\n\n~~~ts\nconst value = 1\n\nstill streaming');

    expect(parts.frozenHtml).toContain('See this:');
    expect(parts.frozenHtml).not.toContain('code-block-shell');
    expect(parts.frozenHtml).not.toContain('still streaming');
    expect(parts.tailText).toContain('~~~ts');
    expect(parts.tailText).toContain('still streaming');
  });

  it('does not close a fence when a matching marker has trailing text', () => {
    const parts = splitStreamingMarkdown('See this:\n\n````md\n````md\ninner\n\nafter inner');

    expect(parts.frozenHtml).toContain('See this:');
    expect(parts.frozenHtml).not.toContain('code-block-shell');
    expect(parts.frozenHtml).not.toContain('after inner');
    expect(parts.tailText).toContain('````md');
    expect(parts.tailText).toContain('after inner');
  });
});

describe('normalizeMarkdownCodeFences', () => {
  it('rewrites lines-first fence info in copied markdown', () => {
    const source = '```1226:1231:crates/agent/src/acp/shared.rs\nfn main() {}\n```';

    expect(normalizeMarkdownCodeFences(source)).toBe(
      '```crates/agent/src/acp/shared.rs:1226-1231\nfn main() {}\n```'
    );
  });

  it('rewrites single-line lines-first fence info', () => {
    const source = '```12:src/lib/main.rs\nfn main() {}\n```';

    expect(normalizeMarkdownCodeFences(source)).toBe(
      '```src/lib/main.rs:12\nfn main() {}\n```'
    );
  });

  it('leaves plain language and path-first fences untouched', () => {
    expect(normalizeMarkdownCodeFences('```rust\nfn main() {}\n```')).toBe(
      '```rust\nfn main() {}\n```'
    );
    expect(normalizeMarkdownCodeFences('```src/lib/main.rs:12:14\nfn main() {}\n```')).toBe(
      '```src/lib/main.rs:12:14\nfn main() {}\n```'
    );
  });

  it('does not treat closing fences or fence interiors as meta', () => {
    const source = 'text\n\n```496:499:a.rs\n```496:499:not-a-fence\n```\nmore';

    expect(normalizeMarkdownCodeFences(source)).toBe(
      'text\n\n```a.rs:496-499\n```496:499:not-a-fence\n```\nmore'
    );
  });

  it('returns the original string when no lines-first fence exists', () => {
    const source = 'plain\n```rust\ncode\n```\ntext';

    expect(normalizeMarkdownCodeFences(source)).toBe(source);
  });
});
