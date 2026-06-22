import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './markdown';

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
});
