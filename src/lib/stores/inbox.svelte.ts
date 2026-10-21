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
import {
  QMT_NOTIFICATION_ELICITATION_COMPLETED,
  QMT_NOTIFICATION_ELICITATION_VALIDATION_FAILED,
  type QuerymtExtensionNotification
} from '$lib/querymt/querymt-extensions';

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

const ELICITATION_FORM_ACTIONS = [
  { id: 'accept', label: 'Submit', kind: 'accept' },
  { id: 'decline', label: 'Decline', kind: 'decline' },
  { id: 'cancel', label: 'Cancel', kind: 'cancel' }
] as const;

export class InboxStore {
  private nextLiveItemId = 1;
  private pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private pendingElicitationRequests = new Map<string, PendingElicitationRequest>();
  private pendingElicitationKeys = new Map<string, string>();
  /** Cards whose resolver was retired offline, keyed by stable elicitation identity. */
  private offlineElicitationKeys = new Map<string, string>();
  /**
   * Cards answered with `accept` whose outcome the agent has not yet confirmed,
   * keyed by stable elicitation identity. If the agent rejects the answer
   * (`validationFailed`) the card is restored to pending and rebound to the
   * question the agent re-delivers.
   */
  private submittedElicitationKeys = new Map<string, string>();
  /** Cards restored after an agent-side validation failure, awaiting re-delivery. */
  private failedElicitationKeys = new Map<string, string>();

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
    return this.actionableItems.filter((item) => item.id.startsWith('live-') && !item.offline).length;
  }

  pendingElicitationsForSession(agentId: string, sessionId: string): InboxItem[] {
    return this.actionableItems.filter(
      (item) => item.type === 'elicitation' && item.agentId === agentId && item.sessionId === sessionId
    );
  }

  /**
   * Reconcile cards against the agent's authoritative pending set.
   *
   * Cards whose stable identity is no longer pending agent-side lose their
   * actionability without sending any fabricated user action; re-delivered
   * identities keep their cards for rebinding.
   */
  reconcileReboundElicitations(agentId: string, sessionId: string, authoritativeIds: string[]) {
    const authoritative = new Set(authoritativeIds.map((id) => `${agentId}:${id}`));
    const stale = new Set<string>();
    const collect = (entries: Iterable<[string, string]>) => {
      for (const [key, itemId] of entries) {
        if (!key.startsWith(`${agentId}:`) || authoritative.has(key)) continue;
        const item = this.items.find((candidate) => candidate.id === itemId);
        if (item && item.status !== 'resolved' && item.sessionId === sessionId) {
          stale.add(itemId);
        }
      }
    };
    collect(this.pendingElicitationKeys.entries());
    collect(this.offlineElicitationKeys.entries());

    for (const itemId of stale) {
      const live = this.pendingElicitationRequests.get(itemId);
      if (live) {
        // Retire the resolver without answering; the question no longer exists.
        this.removePendingElicitation(live);
      } else {
        for (const [key, candidate] of [...this.offlineElicitationKeys.entries()]) {
          if (candidate === itemId) this.offlineElicitationKeys.delete(key);
        }
      }
      this.markResolved(itemId, 'No longer pending');
    }
  }

  bindClient(client: DesktopAcpClient, agentId: string, agentName: string): () => void {
    const unsubscribePermissionRequests = client.onPermissionRequest((request) => {
      return this.enqueuePermissionRequest(request, agentId, agentName);
    });
    const unsubscribeElicitationRequests = client.onElicitationRequest((request) => {
      return this.enqueueElicitationRequest(request, agentId, agentName);
    });

    const unsubscribeNotifications =
      typeof client.onExtensionNotification === 'function'
        ? client.onExtensionNotification((notification) => {
            this.handleElicitationNotification(notification, agentId);
          })
        : null;

    return () => {
      unsubscribePermissionRequests();
      unsubscribeElicitationRequests();
      unsubscribeNotifications?.();
    };
  }

  private handleElicitationNotification(notification: QuerymtExtensionNotification, agentId: string) {
    if (
      notification.method !== QMT_NOTIFICATION_ELICITATION_VALIDATION_FAILED &&
      notification.method !== QMT_NOTIFICATION_ELICITATION_COMPLETED
    ) {
      return;
    }
    const params = notification.params as { elicitation_id?: unknown; message?: unknown } | null;
    const elicitationId = params?.elicitation_id;
    if (typeof elicitationId !== 'string' || !elicitationId) return;
    const key = `${agentId}:${elicitationId}`;

    if (notification.method === QMT_NOTIFICATION_ELICITATION_COMPLETED) {
      // Terminal outcome: the answer was accepted (or superseded elsewhere).
      this.submittedElicitationKeys.delete(key);
      this.failedElicitationKeys.delete(key);
      return;
    }

    const itemId = this.submittedElicitationKeys.get(key);
    if (!itemId) return;
    this.submittedElicitationKeys.delete(key);
    const message = typeof params?.message === 'string' && params.message ? params.message : null;
    this.restoreRejectedElicitation(itemId, key, message);
  }

  /**
   * The agent rejected a submitted answer and keeps the question pending.
   * Make the card actionable again (drafts intact) with the agent's reason;
   * the re-delivered question rebinds to it via `failedElicitationKeys`.
   */
  private restoreRejectedElicitation(itemId: string, key: string, message: string | null) {
    this.items = this.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: 'pending',
            resolution: null,
            error: message ? `The agent rejected this answer: ${message}` : 'The agent rejected this answer.',
            actions: ELICITATION_FORM_ACTIONS.map((action) => ({ ...action }))
          }
        : item
    );
    this.failedElicitationKeys.set(key, itemId);
  }

  disconnectAgent(agentId: string) {
    this.retirePendingRequestsForAgent(agentId);
  }

  async handleAction(itemId: string, actionId: string) {
    if (this.items.find((item) => item.id === itemId)?.offline) {
      // The transport is offline: question cards stay visible but cannot answer.
      return;
    }

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
    if (pending.requestKey && response.action === 'accept') {
      this.submittedElicitationKeys.set(pending.requestKey, itemId);
    }
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

    const offlineItemId = requestKey ? this.offlineElicitationKeys.get(requestKey) : null;
    if (offlineItemId) {
      return this.rebindOfflineElicitation(offlineItemId, requestKey!, request, agentId);
    }

    // A re-delivery of a question we already answered means the agent did not
    // accept that answer. Reuse the same card so the draft is preserved.
    const rejectedItemId = requestKey
      ? (this.failedElicitationKeys.get(requestKey) ?? this.submittedElicitationKeys.get(requestKey))
      : null;
    if (rejectedItemId) {
      const key = requestKey!;
      const existing = this.items.find((candidate) => candidate.id === rejectedItemId);
      if (existing?.status === 'resolved') {
        this.restoreRejectedElicitation(rejectedItemId, key, null);
      }
      this.submittedElicitationKeys.delete(key);
      this.failedElicitationKeys.delete(key);
      return this.rebindOfflineElicitation(rejectedItemId, key, request, agentId, true);
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

  /**
   * Retire resolvers tied to a disconnected transport.
   *
   * Permission requests keep their bounded, connection-scoped behavior: the
   * request belonged to the dead transport, so it settles as cancelled.
   * Keyed question cards and drafts stay pending but are marked offline, so a
   * reconnection can rebind re-delivered questions to the same card instead of
   * answering `cancel` on a transport that no longer exists. Questions without
   * a stable identity can never rebind and are retired locally without any
   * fabricated user action.
   */
  private retirePendingRequestsForAgent(agentId: string) {
    for (const [itemId, pending] of this.pendingPermissionRequests) {
      if (pending.agentId !== agentId) continue;
      this.pendingPermissionRequests.delete(itemId);
      this.markResolved(itemId, 'Cancelled');
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }

    for (const pending of [...this.pendingElicitationRequests.values()]) {
      if (pending.agentId !== agentId) continue;
      this.removePendingElicitation(pending);
      if (pending.requestKey) {
        this.offlineElicitationKeys.set(pending.requestKey, pending.itemId);
        this.markItemOffline(pending.itemId);
      } else {
        this.markResolved(pending.itemId, 'No longer pending');
      }
    }
  }

  private markItemOffline(itemId: string) {
    this.items = this.items.map((item) =>
      item.id === itemId && item.status !== 'resolved' ? { ...item, offline: true } : item
    );
  }

  /**
   * Rebind a re-delivered question to the card that went offline.
   *
   * The stable agent/session/elicitation identity maps the new transport's
   * resolver onto the existing card: drafts survive, no duplicate card or
   * notification is created, and only this new resolver can answer it.
   */
  private rebindOfflineElicitation(
    itemId: string,
    requestKey: string,
    request: CreateElicitationRequest,
    agentId: string,
    keepError = false
  ): Promise<CreateElicitationResponse> {
    this.items = this.items.map((item) =>
      item.id === itemId && item.status !== 'resolved'
        ? {
            ...item,
            offline: false,
            error: keepError ? item.error : null
          }
        : item
    );
    this.offlineElicitationKeys.delete(requestKey);

    return new Promise<CreateElicitationResponse>((resolve) => {
      this.pendingElicitationRequests.set(itemId, {
        itemId,
        agentId,
        requestKey,
        request,
        resolve
      });
      this.pendingElicitationKeys.set(requestKey, itemId);
    });
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
