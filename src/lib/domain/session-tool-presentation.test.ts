import { describe, expect, it } from 'vitest';
import { formatChangeStats, formatTechnicalText, getDelegateTargetAgentId, getSessionToolPresentation, humanizeToolName } from './session-tool-presentation';
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

  it('treats execute tool calls as shell commands with terminal icon and command preview', () => {
    expect(
      getSessionToolPresentation(tool({ title: 'Execute', kind: 'execute', arguments: '{"command":"git status"}' }))
    ).toMatchObject({
      name: 'execute',
      label: 'Run command',
      preview: 'git status',
      icon: 'terminal'
    });
    expect(
      getSessionToolPresentation(tool({ title: 'Execute', kind: 'execute', arguments: '{"command":"bun","args":["run","check"]}' })).preview
    ).toBe('bun run check');
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

  it('summarizes completed edit and write line counts', () => {
    expect(
      getSessionToolPresentation(
        tool({
          title: 'Run edit',
          kind: 'edit',
          arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}',
          result: 'OK paths=1 edits=1 added=1 deleted=2\nP src/app.ts\nH replace old=1,3 new=1,2 +1 -2'
        })
      )
    ).toMatchObject({
      preview: 'src/app.ts',
      changeStats: { added: 1, removed: 2 }
    });
    expect(
      getSessionToolPresentation(
        tool({
          title: 'Run edit',
          kind: 'edit',
          arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}'
        })
      ).changeStats
    ).toEqual({ added: 1, removed: 2 });
    expect(
      getSessionToolPresentation(
        tool({
          title: 'Run multiedit',
          kind: 'multiedit',
          arguments: '{"filePath":"src/lib.ts","edits":[{"oldString":"a\\nb","newString":"a\\nb\\nc"},{"oldString":"x","newString":""}]}'
        })
      ).changeStats
    ).toEqual({ added: 1, removed: 1 });
    expect(
      getSessionToolPresentation(
        tool({
          title: 'Run write_file',
          kind: 'write_file',
          arguments: '{"path":"src/new.ts","content":"export const value = 1;\\nexport const other = 2;\\n"}'
        })
      ).changeStats
    ).toEqual({ added: 2, removed: 0 });
  });

  it('hides edit change stats until the tool completes', () => {
    expect(
      getSessionToolPresentation(
        tool({
          title: 'Run edit',
          kind: 'edit',
          status: 'in_progress',
          arguments: '{"path":"src/app.ts","oldString":"one","newString":"two"}'
        })
      ).changeStats
    ).toBeNull();
    expect(
      getSessionToolPresentation(
        tool({
          title: 'Run edit',
          kind: 'edit',
          status: 'failed',
          arguments: '{"path":"src/app.ts","oldString":"one","newString":"two"}',
          result: 'oldString not found'
        })
      ).changeStats
    ).toBeNull();
  });

  it('summarizes delegate targets and exposes the target agent id', () => {
    const delegate = tool({
      title: 'Run delegate',
      kind: 'delegate',
      arguments: '{"target_agent_id":"linus","objective":"Review the current bearer-auth diff"}'
    });
    expect(getSessionToolPresentation(delegate)).toMatchObject({
      label: 'Delegate task',
      preview: 'linus - Review the current bearer-auth diff',
      icon: 'delegate'
    });
    expect(getDelegateTargetAgentId(delegate)).toBe('linus');
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

  it('formats compact added and removed counts', () => {
    expect(formatChangeStats({ added: 10, removed: 20 })).toBe('+10 -20');
    expect(formatChangeStats({ added: 4, removed: 0 })).toBe('+4');
    expect(formatChangeStats({ added: 0, removed: 2 })).toBe('-2');
    expect(formatChangeStats(null)).toBeNull();
  });
});
