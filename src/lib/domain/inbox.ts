import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationContentValue,
  ElicitationPropertySchema,
  ElicitationSchema,
  PermissionOption,
  RequestPermissionRequest
} from '@agentclientprotocol/sdk';
import type { InboxAction, InboxFormField, InboxFormOption, InboxItem } from '$lib/domain/types';

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
  const formFields = request.mode === 'form' ? mapElicitationFormFields(request.requestedSchema, allowCustom) : [];
  const owner = 'sessionId' in request ? request.sessionId : `request ${String(request.requestId)}`;
  const title = request.mode === 'form' ? request.requestedSchema.title || 'Elicitation request' : 'Elicitation request';

  return {
    id,
    title,
    detail: request.message,
    owner,
    severity: 'medium',
    type: 'elicitation',
    agentId: agentId ?? null,
    agentName: agentName ?? null,
    sessionId: 'sessionId' in request ? request.sessionId : null,
    status: 'pending',
    resolution: null,
    error: null,
    actions:
      request.mode === 'form'
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

function mapElicitationFormFields(schema: ElicitationSchema, allowCustom: boolean): InboxFormField[] {
  const properties = (schema.properties ?? {}) as Record<string, ElicitationPropertySchema>;
  const required = new Set(schema.required ?? []);

  return Object.entries(properties).map(([key, property]) => {
    const options = mapPropertyOptions(property);
    return {
      key,
      label: property.title || key,
      kind: property.type,
      required: required.has(key),
      description: property.description ?? null,
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

function mapPropertyOptions(property: ElicitationPropertySchema): InboxFormOption[] | undefined {
  if (property.type === 'string') {
    if (property.oneOf?.length) {
      return property.oneOf.map((option) => ({ value: option.const, label: option.title }));
    }

    if (property.enum?.length) {
      return property.enum.map((value) => ({ value, label: value }));
    }
  }

  if (property.type === 'array') {
    const items = property.items as {
      anyOf?: Array<{ const: string; title: string }>;
      oneOf?: Array<{ const: string; title: string }>;
      enum?: string[];
    };
    const titledOptions = items.anyOf ?? items.oneOf;
    if (titledOptions?.length) {
      return titledOptions.map((option) => ({ value: option.const, label: option.title }));
    }

    if (items.enum?.length) {
      return items.enum.map((value) => ({ value, label: value }));
    }
  }

  return undefined;
}

function getDefaultFieldValue(property: ElicitationPropertySchema): InboxFormField['value'] {
  if (property.type === 'boolean') {
    return property.default ?? false;
  }

  if (property.type === 'number' || property.type === 'integer') {
    return property.default ?? '';
  }

  if (property.type === 'array') {
    return property.default ?? [];
  }

  return property.default ?? '';
}
