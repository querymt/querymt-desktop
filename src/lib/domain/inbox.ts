import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationContentValue,
  ElicitationPropertySchema,
  ElicitationSchema,
  PermissionOption,
  RequestPermissionRequest
} from '@agentclientprotocol/sdk/unstable';
import { CreateElicitationRequest as ElicitationRequestGuard } from '@agentclientprotocol/sdk/unstable';
import type { InboxAction, InboxFormField, InboxFormOption, InboxItem } from '$lib/domain/types';
import { optionDescriptionsFromMeta } from '$lib/querymt/elicitation-option-meta';

export function mapPermissionRequestToInboxItem(
  request: RequestPermissionRequest,
  id: string,
  agentId?: string,
  agentName?: string
): InboxItem {
  const title = request.toolCall.title?.trim() || 'Permission request';
  const kind = request.toolCall.kind ? ` (${request.toolCall.kind})` : '';

  return {
    id,
    title,
    detail: `${title}${kind} needs approval before the agent can continue.`,
    owner: request.toolCall.title || request.sessionId,
    severity: 'high',
    type: 'permission',
    agentId: agentId ?? null,
    agentName: agentName ?? null,
    sessionId: request.sessionId,
    status: 'pending',
    resolution: null,
    error: null,
    actions: request.options.map(mapPermissionOption)
  };
}

export function mapElicitationRequestToInboxItem(
  request: CreateElicitationRequest,
  id: string,
  agentId?: string,
  agentName?: string
): InboxItem {
  const allowCustom = allowsCustomResponses(request);
  const form = ElicitationRequestGuard.isForm(request) ? request : null;
  const formFields = form
    ? mapElicitationFormFields(form.requestedSchema, allowCustom, optionDescriptionsFromMeta(request._meta))
    : [];
  const scoped = request as { sessionId?: unknown; requestId?: unknown };
  const sessionId = typeof scoped.sessionId === 'string' ? scoped.sessionId : null;
  const owner = sessionId ?? `request ${String(scoped.requestId)}`;
  const title = form ? form.requestedSchema.title || 'Elicitation request' : 'Elicitation request';

  return {
    id,
    title,
    detail: request.message,
    owner,
    severity: 'medium',
    type: 'elicitation',
    agentId: agentId ?? null,
    agentName: agentName ?? null,
    sessionId,
    status: 'pending',
    resolution: null,
    error: null,
    actions:
      form
        ? [
            { id: 'accept', label: 'Submit', kind: 'accept' },
            { id: 'decline', label: 'Decline', kind: 'decline' },
            { id: 'cancel', label: 'Cancel', kind: 'cancel' }
          ]
        : [
            { id: 'accept', label: 'Open flow', kind: 'accept' },
            { id: 'cancel', label: 'Cancel', kind: 'cancel' }
          ],
    formFields
  };
}

export function describePermissionResolution(option: PermissionOption): string {
  switch (option.kind) {
    case 'allow_once':
      return 'Allowed once';
    case 'allow_always':
      return 'Allowed always';
    case 'reject_once':
      return 'Rejected once';
    case 'reject_always':
      return 'Rejected always';
    default:
      return option.name;
  }
}

export function describeElicitationResolution(response: CreateElicitationResponse): string {
  switch (response.action) {
    case 'accept':
      return 'Submitted';
    case 'decline':
      return 'Declined';
    case 'cancel':
      return 'Cancelled';
    default:
      return 'Completed';
  }
}

export function describeElicitationAnswers(fields: InboxFormField[]): Array<{ label: string; answer: string }> {
  const answers: Array<{ label: string; answer: string }> = [];
  for (const field of fields) {
    const answer = describeFieldAnswer(field);
    if (answer) answers.push({ label: field.label, answer });
  }
  return answers;
}

function describeFieldAnswer(field: InboxFormField): string | null {
  if (field.customActive) {
    const customValue = field.customValue?.trim() ?? '';
    return customValue || null;
  }

  if (field.options?.length) {
    if (field.kind === 'array' && Array.isArray(field.value)) {
      const selectedValues = field.value;
      const labels = field.options
        .filter((option) => selectedValues.includes(option.value))
        .map((option) => option.label);
      return labels.length > 0 ? labels.join(', ') : null;
    }

    const selected = field.options.find((option) => option.value === field.value);
    if (selected) return selected.label;
  }

  if (field.kind === 'boolean') return field.value ? 'Yes' : 'No';

  const value = String(field.value ?? '').trim();
  return value || null;
}

export function buildElicitationResponse(actionId: string, fields: InboxFormField[]): CreateElicitationResponse | null {
  if (actionId === 'decline') {
    return { action: 'decline' };
  }

  if (actionId === 'cancel') {
    return { action: 'cancel' };
  }

  if (actionId !== 'accept') {
    return null;
  }

  const content: Record<string, ElicitationContentValue> = {};
  for (const field of fields) {
    if (field.customActive) {
      const customValue = field.customValue?.trim() ?? '';
      content[field.key] = field.kind === 'array' ? [customValue] : customValue;
      continue;
    }

    if (field.kind === 'string') {
      content[field.key] = String(field.value);
      continue;
    }

    if (field.kind === 'number' || field.kind === 'integer') {
      const raw = typeof field.value === 'number' ? field.value : Number(field.value);
      content[field.key] = Number.isFinite(raw) ? raw : 0;
      continue;
    }

    if (field.kind === 'boolean') {
      content[field.key] = Boolean(field.value);
      continue;
    }

    content[field.key] = Array.isArray(field.value) ? field.value : [];
  }

  return {
    action: 'accept',
    content
  };
}

function mapPermissionOption(option: PermissionOption): InboxAction {
  return {
    id: option.optionId,
    label: option.name,
    kind: option.kind
  };
}

function mapElicitationFormFields(
  schema: ElicitationSchema,
  allowCustom: boolean,
  optionDescriptions: Record<string, Record<string, string>>
): InboxFormField[] {
  const properties = (schema.properties ?? {}) as Record<string, ElicitationPropertySchema>;
  const required = new Set(schema.required ?? []);

  return Object.entries(properties).map(([key, property]) => {
    const options = mapPropertyOptions(property, optionDescriptions[key]);
    const loose = property as LooseProperty;
    return {
      key,
      label: loose.title || key,
      kind: loose.type as InboxFormField['kind'],
      required: required.has(key),
      description: loose.description ?? null,
      options,
      value: getDefaultFieldValue(property),
      allowCustom: allowCustom && Boolean(options?.length),
      customActive: false,
      customValue: ''
    };
  });
}

function allowsCustomResponses(request: CreateElicitationRequest): boolean {
  const querymtMeta = request._meta?.querymt;
  if (!querymtMeta || typeof querymtMeta !== 'object') return false;
  const metadata = querymtMeta as Record<string, unknown>;
  return metadata.source === 'builtin:question' || metadata.allow_custom === true || metadata.allowCustom === true;
}

type LooseProperty = {
  type: string;
  title?: string | null;
  description?: string | null;
  default?: unknown;
  oneOf?: TitledElicitationOption[];
  enum?: string[];
  items?: unknown;
};

function mapPropertyOptions(
  rawProperty: ElicitationPropertySchema,
  optionDescriptions?: Record<string, string>
): InboxFormOption[] | undefined {
  const property = rawProperty as LooseProperty;
  if (property.type === 'string') {
    if (property.oneOf?.length) {
      return property.oneOf.map((option) => mapTitledOption(option, optionDescriptions?.[option.const]));
    }

    if (property.enum?.length) {
      return property.enum.map((value) => ({ value, label: value }));
    }
  }

  if (property.type === 'array') {
    const items = property.items as {
      anyOf?: TitledElicitationOption[];
      oneOf?: TitledElicitationOption[];
      enum?: string[];
    };
    const titledOptions = items.anyOf ?? items.oneOf;
    if (titledOptions?.length) {
      return titledOptions.map((option) => mapTitledOption(option, optionDescriptions?.[option.const]));
    }

    if (items.enum?.length) {
      return items.enum.map((value) => ({ value, label: value }));
    }
  }

  return undefined;
}

type TitledElicitationOption = {
  const: string;
  title: string;
  description?: string | null;
  _meta?: {
    querymt?: {
      description?: unknown;
    };
  } | null;
};

function titledOptionDescription(option: TitledElicitationOption, fallback?: string): string | undefined {
  const candidates = [option.description, option._meta?.querymt?.description, fallback];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const description = candidate.trim();
    if (description && description !== option.title) return description;
  }
  return undefined;
}

function mapTitledOption(option: TitledElicitationOption, fallback?: string): InboxFormOption {
  const description = titledOptionDescription(option, fallback);
  return {
    value: option.const,
    label: option.title,
    ...(description ? { description } : {})
  };
}

function getDefaultFieldValue(rawProperty: ElicitationPropertySchema): InboxFormField['value'] {
  const property = rawProperty as LooseProperty;
  const fallback = property.default as InboxFormField['value'] | undefined;
  if (property.type === 'boolean') return fallback ?? false;
  if (property.type === 'number' || property.type === 'integer') return fallback ?? '';
  if (property.type === 'array') return fallback ?? [];
  return fallback ?? '';
}
