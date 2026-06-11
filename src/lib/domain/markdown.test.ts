import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './markdown';

describe('renderMarkdownToHtml', () => {
  it('wraps fenced code in a constrained code-block shell', () => {
    const html = renderMarkdownToHtml('```ts\nconst value = "hello";\n```');

    expect(html).toContain('code-block-shell');
    expect(html).toContain('code-block-header');
    expect(html).toContain('language-ts');
    expect(html).toContain('tok-keyword');
  });

  it('escapes raw html outside and inside code blocks', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>\n\n```html\n<div>bad</div>\n```');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;div&gt;bad&lt;/div&gt;');
  });
});
