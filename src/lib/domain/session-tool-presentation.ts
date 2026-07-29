import type { SessionToolCallItem } from '$lib/domain/types';

export type SessionToolIcon =
  | 'terminal'
  | 'read'
  | 'edit'
  | 'search'
  | 'web'
  | 'question'
  | 'delegate'
  | 'task'
  | 'skill'
  | 'delete'
  | 'tool';

export type SessionToolPresentation = {
  name: string;
  label: string;
  preview: string | null;
  icon: SessionToolIcon;
  statusLabel: string;
  expandable: boolean;
  argumentsText: string | null;
  resultText: string | null;
};

const READ_TOOLS = new Set(['read_tool', 'get_function', 'get_symbol', 'index', 'ls', 'read_shared']);
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'replace_symbol', 'write_file', 'apply_patch']);
const SEARCH_TOOLS = new Set(['search_text', 'glob', 'find_references', 'find_symbol_references', 'mdq', 'language_query']);
const WEB_TOOLS = new Set(['browse', 'web_fetch']);
const TASK_TOOLS = new Set(['create_task', 'todowrite', 'todoread']);

export function getSessionToolPresentation(tool: SessionToolCallItem): SessionToolPresentation {
  const name = normalizeToolName(tool);
  const argumentsText = formatTechnicalText(tool.arguments);
  const resultText = formatTechnicalText(tool.result);

  return {
    name,
    label: toolLabel(name),
    preview: toolPreview(name, parseObject(tool.arguments), tool.result),
    icon: toolIcon(name),
    statusLabel: statusLabel(tool.status),
    expandable: Boolean(argumentsText || resultText),
    argumentsText,
    resultText
  };
}

export function humanizeToolName(value: string): string {
  const normalized = value
    .replace(/^mcp[_:.\/-]?/i, '')
    .replace(/^run\s+/i, '')
    .replace(/[_.:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Tool call';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatTechnicalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function normalizeToolName(tool: SessionToolCallItem): string {
  const kind = tool.kind?.trim();
  if (kind && kind !== 'other') return stripRunPrefix(kind).toLowerCase();
  return stripRunPrefix(tool.title).toLowerCase();
}

function stripRunPrefix(value: string): string {
  return value.replace(/^run\s+/i, '').trim();
}

function toolLabel(name: string): string {
  if (name === 'shell') return 'Run command';
  if (name === 'read_tool') return 'Read file';
  if (name === 'get_function') return 'Read function';
  if (name === 'get_symbol') return 'Read symbol';
  if (name === 'index') return 'Inspect file structure';
  if (name === 'ls') return 'List directory';
  if (name === 'read_shared') return 'Read shared context';
  if (name === 'edit') return 'Edit file';
  if (name === 'multiedit') return 'Edit file';
  if (name === 'replace_symbol') return 'Replace symbol';
  if (name === 'write_file') return 'Write file';
  if (name === 'apply_patch') return 'Apply patch';
  if (name === 'delete_file') return 'Delete file';
  if (name === 'search_text') return 'Search text';
  if (name === 'glob') return 'Find files';
  if (name === 'find_references' || name === 'find_symbol_references') return 'Find references';
  if (name === 'mdq') return 'Search Markdown';
  if (name === 'language_query') return 'Query language server';
  if (name === 'browse' || name === 'web_fetch') return 'Fetch URL';
  if (name === 'question') return 'Ask question';
  if (name === 'delegate' || name === 'route_delegation_to_peer') return 'Delegate task';
  if (name === 'create_task') return 'Create task';
  if (name === 'todowrite') return 'Update tasks';
  if (name === 'todoread') return 'Read tasks';
  if (name === 'skill') return 'Load skill';
  return humanizeToolName(name);
}

function toolIcon(name: string): SessionToolIcon {
  if (name === 'shell') return 'terminal';
  if (READ_TOOLS.has(name)) return 'read';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (name === 'delete_file') return 'delete';
  if (SEARCH_TOOLS.has(name)) return 'search';
  if (WEB_TOOLS.has(name)) return 'web';
  if (name === 'question') return 'question';
  if (name === 'delegate' || name === 'route_delegation_to_peer') return 'delegate';
  if (TASK_TOOLS.has(name)) return 'task';
  if (name === 'skill') return 'skill';
  return 'tool';
}

function statusLabel(status: SessionToolCallItem['status']): string {
  if (status === 'in_progress') return 'Running';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function toolPreview(name: string, args: Record<string, unknown> | null, rawResult: string | null | undefined): string | null {
  if (!args) return resultPreview(rawResult);

  if (name === 'shell') {
    const command = stringValue(args.command);
    const commandArgs = Array.isArray(args.args) ? args.args.filter((item): item is string => typeof item === 'string') : [];
    return compact([command, ...commandArgs].filter(Boolean).join(' '));
  }
  if (name === 'search_text') {
    const pattern = stringValue(args.pattern);
    const location = stringValue(args.include) || stringValue(args.path);
    return compact(pattern ? `${quote(pattern)}${location ? ` in ${location}` : ''}` : location);
  }
  if (name === 'glob') {
    const pattern = stringValue(args.pattern);
    const path = stringValue(args.path);
    return compact(pattern ? `${pattern}${path ? ` in ${path}` : ''}` : path);
  }
  if (name === 'question') {
    const questions = Array.isArray(args.questions) ? args.questions.length : 0;
    return questions > 0 ? `${questions} question${questions === 1 ? '' : 's'}` : null;
  }
  if (name === 'delegate' || name === 'route_delegation_to_peer') {
    const target = stringValue(args.target_agent_id) || stringValue(args.peer);
    const objective = stringValue(args.objective);
    return compact([target, objective].filter(Boolean).join(' - '));
  }
  if (name === 'todowrite') {
    const todos = Array.isArray(args.todos) ? args.todos.length : 0;
    return todos > 0 ? `${todos} task${todos === 1 ? '' : 's'}` : null;
  }
  if (name === 'create_task') return compact(stringValue(args.expected_deliverable) || stringValue(args.kind));
  if (name === 'skill') return compact(stringValue(args.name));
  if (name === 'browse' || name === 'web_fetch') return compact(stringValue(args.url));
  if (name === 'replace_symbol') {
    const replacements = Array.isArray(args.replacements) ? args.replacements : [];
    const first = replacements[0];
    const firstPath = first && typeof first === 'object' ? stringValue((first as Record<string, unknown>).path) : '';
    return replacements.length > 1 ? compact(`${firstPath || 'symbols'} +${replacements.length - 1} more`) : compact(firstPath);
  }

  const path = stringValue(args.path) || stringValue(args.filePath) || stringValue(args.file_path) || stringValue(args.root);
  if (path) return compact(path);
  const symbol = stringValue(args.symbol) || stringValue(args.pattern) || stringValue(args.action);
  return compact(symbol) ?? resultPreview(rawResult);
}

function parseObject(value: string | null | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function quote(value: string): string {
  return `"${value}"`;
}

function resultPreview(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
  return compact(trimmed.split('\n').find(Boolean) ?? '');
}

function compact(value: string | null | undefined, maxLength = 110): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
