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
  request: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
}

interface PendingElicitationRequest {
  itemId: string;
  request: CreateElicitationRequest;
  resolve: (response: CreateElicitationResponse) => void;
}

class InboxStore {
  private nextLiveItemId = 1;
  private pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private pendingElicitationRequests = new Map<string, PendingElicitationRequest>();

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
    this.items = this.items.map((item) => {
      if (item.id !== itemId || !item.formFields) {
        return item;
      }

      return {
        ...item,
        error: null,
        formFields: item.formFields.map((field) =>
          field.key === fieldKey
            ? {
                ...field,
                value
              }
            : field
        )
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
    this.items = this.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: 'resolved',
            resolution: describePermissionResolution(option),
            actions: []
          }
        : item
    );

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

    this.pendingElicitationRequests.delete(itemId);
    this.items = this.items.map((candidate) =>
      candidate.id === itemId
        ? {
            ...candidate,
            error: null,
            status: 'resolved',
            resolution: describeElicitationResolution(response),
            actions: []
          }
        : candidate
    );

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
    const itemId = `live-elicitation-${this.nextLiveItemId++}`;
    const item = mapElicitationRequestToInboxItem(request, itemId, agentId, agentName);
    this.items = [item, ...this.items];
    void sendDesktopNotification(item.title, item.detail);

    return new Promise<CreateElicitationResponse>((resolve) => {
      this.pendingElicitationRequests.set(itemId, {
        itemId,
        request,
        resolve
      });
    });
  }
}

function validateElicitationFields(fields: InboxFormField[], actionId: string): string | null {
  if (actionId !== 'accept') {
    return null;
  }

  for (const field of fields) {
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
