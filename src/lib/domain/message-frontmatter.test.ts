import { describe, expect, it } from 'vitest';
import { extractMessageFrontMatter, validateMessageFrontMatter } from './message-frontmatter';

describe('extractMessageFrontMatter', () => {
  it('preserves the exact prefix and body including CRLF, quoting, and comments', () => {
    const source = '\uFEFF---\r\n# callback\r\ntype: "callback"\r\nnested:\r\n  delay: 60\r\n---\r\n';
    const body = '\r\n**Callback received.**\r\n';
    expect(extractMessageFrontMatter(source + body)).toEqual({
      body,
      frontMatter: { source, yaml: '# callback\r\ntype: "callback"\r\nnested:\r\n  delay: 60\r\n' }
    });
  });

  it.each(['---', '...'])('accepts %s as the closing delimiter, including at EOF', (closing) => {
    expect(extractMessageFrontMatter(`---\nkey: value\n${closing}`)).toMatchObject({ body: '', frontMatter: { yaml: 'key: value\n' } });
    expect(extractMessageFrontMatter(`--- \t\nkey: value\n${closing} \t\nBody`)).toMatchObject({ body: 'Body' });
  });

  it.each(['key: [broken', '- a\n- b', '', 'key: one\nkey: two', 'key: !unknown value'])('extracts metadata regardless of YAML validity: %s', (yaml) => {
    expect(extractMessageFrontMatter(`---\n${yaml}\n---\nBody`)).toMatchObject({ body: 'Body', frontMatter: { yaml: `${yaml}\n` } });
  });

  it.each([
    'Ordinary message',
    'Title\n---\nBody',
    'Body\n\n---\nkey: value\n---',
    '```yaml\n---\nkey: value\n---\n```',
    '\n---\nkey: value\n---\nBody',
    ' ---\nkey: value\n---\nBody',
    '---\nkey: value\nBody without a closing delimiter',
    '---',
    '---\nkey: value\n---not-a-delimiter\nBody'
  ])('leaves non-front-matter Markdown untouched: %s', (text) => {
    expect(extractMessageFrontMatter(text)).toEqual({ body: text, frontMatter: null });
  });

  it('does not strip later delimiters from the body', () => {
    const body = '\nBody\n\n---\nmore: content\n---\n';
    expect(extractMessageFrontMatter(`---\nkey: value\n---\n${body}`).body).toBe(body);
  });
});

describe('validateMessageFrontMatter', () => {
  it('accepts a YAML mapping with nested values', () => {
    expect(validateMessageFrontMatter('type: callback\nnested:\n  delay: 60\n  tags: [timer, scheduled]\n')).toBeNull();
  });

  it.each(['key: [broken', 'key: a\nkey: b', 'key: !unknown value'])('reports invalid or unsupported YAML without throwing: %s', (source) => {
    expect(validateMessageFrontMatter(source)).toEqual(expect.any(String));
  });

  it.each(['plain text', '- item', '', 'null'])('requires a metadata mapping: %s', (source) => {
    expect(validateMessageFrontMatter(source)).toContain('Expected a YAML mapping');
  });

  it('does not expand recursive aliases or construct JavaScript objects', () => {
    expect(validateMessageFrontMatter('self: &self [*self]\n__proto__: {polluted: true}\n')).toBeNull();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('bounds validation work for oversized input', () => {
    expect(validateMessageFrontMatter('key: ' + 'x'.repeat(64 * 1024))).toContain('too large to validate');
  });
});
