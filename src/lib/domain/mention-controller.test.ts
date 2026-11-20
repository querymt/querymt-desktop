import { describe, expect, it } from 'vitest';
import {
  MentionController,
  acceptMention,
  detectMentionTrigger,
  extractActiveMentions,
  mentionText,
  type AcceptedMention,
  type MentionEntry
} from './mention-controller';

const file = (path: string, uri = `file:///repo/${path}`): MentionEntry => ({
  path, uri, name: path.split('/').at(-1)!, isDir: false
});
const dir = (path: string): MentionEntry => ({ path, uri: `file:///repo/${path}`, name: path.split('/').at(-1)!, isDir: true });
const accepted = (text: string, uri: string): AcceptedMention => ({ text, uri, name: text, isDir: false });

describe('detectMentionTrigger', () => {
  it('opens at the start of the text and after whitespace', () => {
    expect(detectMentionTrigger('@src', 4)).toMatchObject({ start: 0, query: 'src' });
    expect(detectMentionTrigger('look at @src', 12)).toMatchObject({ start: 8, query: 'src' });
    expect(detectMentionTrigger('a\n@x', 4)).toMatchObject({ start: 2, query: 'x' });
  });

  it('does not open inside a word such as an email address', () => {
    expect(detectMentionTrigger('mail foo@bar.com', 16)).toBeNull();
  });

  it('closes once whitespace separates the caret from the token', () => {
    expect(detectMentionTrigger('@a.ts ', 6)).toBeNull();
  });

  it('supports quoted queries containing spaces', () => {
    expect(detectMentionTrigger('@"my no', 7)).toMatchObject({ quoted: true, query: 'my no' });
    expect(detectMentionTrigger('@"my notes" x', 13)).toBeNull();
  });

  it('extends the replaced range over the rest of the token after the caret', () => {
    expect(detectMentionTrigger('@src/lib', 4)).toMatchObject({ start: 0, end: 8, query: 'src' });
  });
});

describe('acceptMention', () => {
  it('Enter on a file inserts the path, a trailing space and records the mention', () => {
    const trigger = detectMentionTrigger('look @a.t', 9)!;
    const result = acceptMention('look @a.t', trigger, file('src/lib/a.ts'), 'enter', []);
    expect(result.text).toBe('look @src/lib/a.ts ');
    expect(result.caret).toBe(result.text.length);
    expect(result.keepOpen).toBe(false);
    expect(result.mentions).toEqual([
      { text: '@src/lib/a.ts', uri: 'file:///repo/src/lib/a.ts', name: 'a.ts', isDir: false }
    ]);
  });

  it('Tab on a file behaves like Enter', () => {
    const trigger = detectMentionTrigger('@a', 2)!;
    const result = acceptMention('@a', trigger, file('a.ts'), 'tab', []);
    expect(result.text).toBe('@a.ts ');
    expect(result.mentions).toHaveLength(1);
  });

  it('Enter on a directory inserts a trailing slash and records a directory mention', () => {
    const trigger = detectMentionTrigger('@src', 4)!;
    const result = acceptMention('@src', trigger, dir('src/lib'), 'enter', []);
    expect(result.text).toBe('@src/lib/ ');
    expect(result.keepOpen).toBe(false);
    expect(result.mentions).toEqual([expect.objectContaining({ text: '@src/lib/', isDir: true })]);
  });

  it('Tab on a directory drills down without a space or a recorded mention', () => {
    const trigger = detectMentionTrigger('@src', 4)!;
    const result = acceptMention('@src', trigger, dir('src/lib'), 'tab', []);
    expect(result.text).toBe('@src/lib/');
    expect(result.keepOpen).toBe(true);
    expect(result.mentions).toEqual([]);
    expect(detectMentionTrigger(result.text, result.caret)).toMatchObject({ query: 'src/lib/' });
  });

  it('quotes paths containing whitespace', () => {
    const entry = file('docs/my notes.md');
    expect(mentionText(entry)).toBe('@"docs/my notes.md"');
    const trigger = detectMentionTrigger('@my', 3)!;
    const result = acceptMention('@my', trigger, entry, 'enter', []);
    expect(result.text).toBe('@"docs/my notes.md" ');
    expect(result.mentions[0].text).toBe('@"docs/my notes.md"');
  });

  it('keeps text after the token and does not double the separating space', () => {
    const trigger = detectMentionTrigger('@a and more', 2)!;
    const result = acceptMention('@a and more', trigger, file('a.ts'), 'enter', []);
    expect(result.text).toBe('@a.ts and more');
    expect(result.caret).toBe('@a.ts '.length);
  });
});

describe('extractActiveMentions', () => {
  const a = accepted('@a.ts', 'file:///repo/a.ts');

  it('matches whole tokens including trailing punctuation', () => {
    expect(extractActiveMentions('look at @a.ts, please', [a])).toEqual([a]);
    expect(extractActiveMentions('(see @a.ts)', [a])).toEqual([a]);
    expect(extractActiveMentions('see @a.ts.', [a])).toEqual([a]);
    expect(extractActiveMentions('@a.ts', [a])).toEqual([a]);
  });

  it('excludes mentions edited away', () => {
    expect(extractActiveMentions('nothing here', [a])).toEqual([]);
  });

  it('excludes mentions that were extended or turned into a directory', () => {
    expect(extractActiveMentions('@a.tsx', [a])).toEqual([]);
    expect(extractActiveMentions('@a.ts/', [a])).toEqual([]);
    expect(extractActiveMentions('x@a.ts', [a])).toEqual([]);
  });

  it('finds a later whole-token occurrence after a partial one', () => {
    expect(extractActiveMentions('@a.tsx and @a.ts', [a])).toEqual([a]);
  });

  it('deduplicates by uri', () => {
    const twin = accepted('@./a.ts', 'file:///repo/a.ts');
    expect(extractActiveMentions('@a.ts @./a.ts @a.ts', [a, twin])).toEqual([a]);
  });
});

describe('MentionController', () => {
  it('opens on a trigger, resets selection when the query changes and wraps on move', () => {
    const controller = new MentionController();
    expect(controller.update('@a', 2)).not.toBeNull();
    controller.move(1, 3);
    controller.move(1, 3);
    expect(controller.selectedIndex).toBe(2);
    controller.move(1, 3);
    expect(controller.selectedIndex).toBe(0);
    controller.move(-1, 3);
    expect(controller.selectedIndex).toBe(2);
    controller.update('@ab', 3);
    expect(controller.selectedIndex).toBe(0);
  });

  it('Escape closes the list for that token but a new token reopens it', () => {
    const controller = new MentionController();
    controller.update('@a', 2);
    controller.dismiss();
    expect(controller.isOpen).toBe(false);
    expect(controller.update('@a', 2)).toBeNull();
    controller.update('@a ', 3);
    expect(controller.update('@a @b', 5)).not.toBeNull();
  });

  it('accepts the selected entry', () => {
    const controller = new MentionController();
    controller.update('@', 1);
    controller.move(1, 2);
    const result = controller.accept('@', [file('a.ts'), file('b.ts')], 'enter', []);
    expect(result?.text).toBe('@b.ts ');
  });
});
