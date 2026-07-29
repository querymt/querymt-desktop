import { describe, expect, it } from 'vitest';
import { formatTechnicalText, getSessionToolPresentation, humanizeToolName } from './session-tool-presentation';
import type { SessionToolCallItem } from './types';

function tool(overrides: Partial<SessionToolCallItem> = {}): SessionToolCallItem {
  return {
    id: 'tool-1',
    title: 'Run read_tool',
    status: 'completed',
    kind: 'read_tool',
    ...overrides
  };
}

describe('getSessionToolPresentation', () => {
  it('uses semantic labels, icons, and path previews for file reads', () => {
    expect(getSessionToolPresentation(tool({ arguments: '{"path":"src/app.ts"}' }))).toMatchObject({
      name: 'read_tool',
      label: 'Read file',
      preview: 'src/app.ts',
      icon: 'read',
      statusLabel: 'Completed',
      expandable: true
    });
  });

  it('summarizes shell commands and search locations', () => {
    expect(
      getSessionToolPresentation(tool({ title: 'Run shell', kind: 'shell', arguments: '{"command":"bun","args":["run","check"]}' }))
        .preview
    ).toBe('bun run check');
    expect(
      getSessionToolPresentation(
        tool({ title: 'Run search_text', kind: 'search_text', arguments: '{"pattern":"ToolCall","include":"*.ts"}' })
      ).preview
    ).toBe('"ToolCall" in *.ts');
  });

  it('describes structured task and question tools without exposing their full input', () => {
    expect(
      getSessionToolPresentation(
        tool({ title: 'Run question', kind: 'question', arguments: '{"questions":[{"question":"One"},{"question":"Two"}]}' })
      ).preview
    ).toBe('2 questions');
    expect(
      getSessionToolPresentation(
        tool({ title: 'Run todowrite', kind: 'todowrite', arguments: '{"todos":[{},{}]}' })
      ).preview
    ).toBe('2 tasks');
  });

  it('uses restrained failure semantics and keeps technical detail expandable', () => {
    expect(
      getSessionToolPresentation(tool({ status: 'failed', result: 'oldString not found' }))
    ).toMatchObject({ statusLabel: 'Failed', resultText: 'oldString not found', expandable: true });
  });
});

describe('tool text formatting', () => {
  it('pretty prints valid JSON and preserves arbitrary text', () => {
    expect(formatTechnicalText('{"path":"README.md"}')).toBe('{\n  "path": "README.md"\n}');
    expect(formatTechnicalText('plain output\nsecond line')).toBe('plain output\nsecond line');
  });

  it('humanizes unknown provider and MCP tool names', () => {
    expect(humanizeToolName('mcp_custom.lookup-symbol')).toBe('Custom lookup symbol');
  });
});
