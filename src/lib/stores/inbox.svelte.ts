import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk';
import {
  buildElicitationResponse,
  describeElicitationResolution,
  describePermissionResolution,
  mapElicitationRequestToInboxItem,
  mapPermissionRequestToInboxItem
} from '$lib/domain/inbox';
import type { InboxFormField, InboxItem } from '$lib/domain/types';
import { DesktopAcpClient } from '$lib/querymt/acp-client';
import { sendDesktopNotification } from '$lib/querymt/notifications';

interface PendingPermissionRequest {
  itemId: string;
  agentId: string;
  request: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
}

interface PendingElicitationRequest {
  itemId: string;
  agentId: string;
  requestKey: string | null;
  request: CreateElicitationRequest;
  resolve: (response: CreateElicitationResponse) => void;
}

export class InboxStore {
  private nextLiveItemId = 1;
  private pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private pendingElicitationRequests = new Map<string, PendingElicitationRequest>();
  private pendingElicitationKeys = new Map<string, string>();

  items = $state<InboxItem[]>([]);

  get pendingItems(): InboxItem[] {
    return this.items.filter((item) => item.status !== 'resolved');
  }

  get actionableItems(): InboxItem[] {
    return this.pendingItems.filter((item) => Boolean(item.actions?.length));
  }

  get pendingCount(): number {
    return this.pendingItems.length;
  }

  get liveRequestCount(): number {
    return this.actionableItems.filter((item) => item.id.startsWith('live-')).length;
  }

  pendingElicitationsForSession(agentId: string, sessionId: string): InboxItem[] {
    return this.actionableItems.filter(
      (item) => item.type === 'elicitation' && item.agentId === agentId && item.sessionId === sessionId
    );
  }

  bindClient(client: DesktopAcpClient, agentId: string, agentName: string): () => void {
    const unsubscribePermissionRequests = client.onPermissionRequest((request) => {
      return this.enqueuePermissionRequest(request, agentId, agentName);
    });
    const unsubscribeElicitationRequests = client.onElicitationRequest((request) => {
      return this.enqueueElicitationRequest(request, agentId, agentName);
    });

    return () => {
      unsubscribePermissionRequests();
      unsubscribeElicitationRequests();
    };
  }

  disconnectAgent(agentId: string) {
    this.cancelPendingRequestsForAgent(agentId);
  }

  async handleAction(itemId: string, actionId: string) {
    if (this.pendingPermissionRequests.has(itemId)) {
      this.resolvePermissionRequest(itemId, actionId);
      return;
    }

    if (this.pendingElicitationRequests.has(itemId)) {
      this.resolveElicitationRequest(itemId, actionId);
    }
  }

  updateField(itemId: string, fieldKey: string, value: InboxFormField['value']) {
    this.updateFormField(itemId, fieldKey, (field) => ({
      ...field,
      value,
      customActive: false,
      customValue: ''
    }));
  }

  setCustomFieldActive(itemId: string, fieldKey: string, active: boolean) {
    this.updateFormField(itemId, fieldKey, (field) => ({
      ...field,
      value: active ? (field.kind === 'array' ? [] : '') : field.value,
      customActive: active,
      customValue: active ? field.customValue ?? '' : ''
    }));
  }

  updateCustomField(itemId: string, fieldKey: string, value: string) {
    this.updateFormField(itemId, fieldKey, (field) => ({
      ...field,
      value: field.kind === 'array' ? [] : '',
      customActive: true,
      customValue: value
    }));
  }

  private updateFormField(itemId: string, fieldKey: string, update: (field: InboxFormField) => InboxFormField) {
    this.items = this.items.map((item) => {
      if (item.id !== itemId || !item.formFields) return item;
      return {
        ...item,
        error: null,
        formFields: item.formFields.map((field) => (field.key === fieldKey ? update(field) : field))
      };
    });
  }

  private resolvePermissionRequest(itemId: string, actionId: string) {
    const pending = this.pendingPermissionRequests.get(itemId);
    if (!pending) {
      return;
    }

    const option = pending.request.options.find((candidate) => candidate.optionId === actionId);
    if (!option) {
      return;
    }

    this.pendingPermissionRequests.delete(itemId);
    this.markResolved(itemId, describePermissionResolution(option));
    pending.resolve({
      outcome: {
        outcome: 'selected',
        optionId: option.optionId
      }
    });
  }

  private resolveElicitationRequest(itemId: string, actionId: string) {
    const pending = this.pendingElicitationRequests.get(itemId);
    if (!pending) {
      return;
    }

    const item = this.items.find((candidate) => candidate.id === itemId);
    const fields = item?.formFields ?? [];
    const validationError = validateElicitationFields(fields, actionId);
    if (validationError) {
      this.items = this.items.map((candidate) =>
        candidate.id === itemId
          ? {
              ...candidate,
              error: validationError
            }
          : candidate
      );
      return;
    }

    const response = buildElicitationResponse(actionId, fields);
    if (!response) {
      return;
    }

    this.removePendingElicitation(pending);
    this.markResolved(itemId, describeElicitationResolution(response));
    pending.resolve(response);
  }

  private enqueuePermissionRequest(
    request: RequestPermissionRequest,
    agentId: string,
    agentName: string
  ): Promise<RequestPermissionResponse> {
    const itemId = `live-permission-${this.nextLiveItemId++}`;
    const item = mapPermissionRequestToInboxItem(request, itemId, agentId, agentName);
    this.items = [item, ...this.items];
    void sendDesktopNotification(item.title, item.detail);

    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissionRequests.set(itemId, {
        itemId,
        agentId,
        request,
        resolve
      });
    });
  }

  private enqueueElicitationRequest(
    request: CreateElicitationRequest,
    agentId: string,
    agentName: string
  ): Promise<CreateElicitationResponse> {
    const requestKey = getElicitationRequestKey(request, agentId);
    const existingItemId = requestKey ? this.pendingElicitationKeys.get(requestKey) : null;
    if (existingItemId) {
      return Promise.resolve({ action: 'cancel' });
    }

    const itemId = `live-elicitation-${this.nextLiveItemId++}`;
    const item = mapElicitationRequestToInboxItem(request, itemId, agentId, agentName);
    this.items = [item, ...this.items];
    if (requestKey) this.pendingElicitationKeys.set(requestKey, itemId);
    void sendDesktopNotification(item.title, item.detail);

    return new Promise<CreateElicitationResponse>((resolve) => {
      this.pendingElicitationRequests.set(itemId, {
        itemId,
        agentId,
        requestKey,
        request,
        resolve
      });
    });
  }

  private cancelPendingRequestsForAgent(agentId: string) {
    for (const [itemId, pending] of this.pendingPermissionRequests) {
      if (pending.agentId !== agentId) continue;
      this.pendingPermissionRequests.delete(itemId);
      this.markResolved(itemId, 'Cancelled');
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }

    for (const pending of [...this.pendingElicitationRequests.values()]) {
      if (pending.agentId !== agentId) continue;
      this.removePendingElicitation(pending);
      this.markResolved(pending.itemId, 'Cancelled');
      pending.resolve({ action: 'cancel' });
    }
  }

  private removePendingElicitation(pending: PendingElicitationRequest) {
    this.pendingElicitationRequests.delete(pending.itemId);
    if (pending.requestKey) this.pendingElicitationKeys.delete(pending.requestKey);
  }

  private markResolved(itemId: string, resolution: string) {
    this.items = this.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            error: null,
            status: 'resolved',
            resolution,
            actions: []
          }
        : item
    );
  }
}

function getElicitationRequestKey(request: CreateElicitationRequest, agentId: string): string | null {
  const querymtMeta = request._meta?.querymt;
  if (!querymtMeta || typeof querymtMeta !== 'object') return null;
  const elicitationId = (querymtMeta as Record<string, unknown>).elicitation_id;
  return typeof elicitationId === 'string' && elicitationId ? `${agentId}:${elicitationId}` : null;
}

function validateElicitationFields(fields: InboxFormField[], actionId: string): string | null {
  if (actionId !== 'accept') {
    return null;
  }

  for (const field of fields) {
    if (field.customActive) {
      if (!field.customValue?.trim()) return 'Please enter a custom response.';
      continue;
    }

    if (!field.required) {
      continue;
    }

    if (field.kind === 'boolean') {
      continue;
    }

    if (field.kind === 'array') {
      if (!Array.isArray(field.value) || field.value.length === 0) {
        return `Please complete ${field.label}.`;
      }
      continue;
    }

    if (String(field.value).trim().length === 0) {
      return `Please complete ${field.label}.`;
    }
  }

  return null;
}

export const inboxStore = new InboxStore();
