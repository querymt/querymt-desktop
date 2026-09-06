import { marked } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import { renderMarkdownToHtml, splitStreamingMarkdown } from './markdown';

describe('renderMarkdownToHtml', () => {
  it('wraps fenced code in a constrained code-block shell', () => {
    const html = renderMarkdownToHtml('```ts\nconst value = "hello";\n```');

    expect(html).toContain('code-block-shell');
    expect(html).toContain('code-block-header');
    expect(html).toContain('data-code-copy');
    expect(html).toContain('language-ts');
    expect(html).toContain('const value =');
    expect(html).not.toContain('tok-keyword');
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
});
