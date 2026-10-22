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
  requestKey: string | null;
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
  /**
   * Live permission cards, keyed by the agent's interaction ID (or, for an agent
   * that omits it, a tool-call fallback key).
   */
  private pendingPermissionKeys = new Map<string, string>();
  /**
   * Permission cards whose resolver was retired by a transport loss, keyed like
   * `pendingPermissionKeys`. A re-delivered request rebinds to them.
   */
  private offlinePermissionKeys = new Map<string, string>();
  /**
   * Permission cards answered by the user whose outcome the agent has not
   * visibly applied. A permission has no completion notification, so a
   * re-delivery of the same identity means the agent kept it pending (it
   * rejected the answer, or the answer was lost) and rebinds to the card.
   */
  private submittedPermissionKeys = new Map<string, string>();
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
  reconcileReboundElicitations(
    agentId: string,
    sessionId: string,
    authoritativeIds: string[],
    boundary?: ReadonlySet<string>
  ) {
    const authoritative = new Set(authoritativeIds.map((id) => `${agentId}:${id}`));
    const stale = new Set<string>();
    const collect = (entries: Iterable<[string, string]>) => {
      for (const [key, itemId] of entries) {
        if (!key.startsWith(`${agentId}:`) || authoritative.has(key)) continue;
        // A card created after the recovery snapshot began is newer than the agent's answer.
        if (boundary && !boundary.has(itemId)) continue;
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

    this.reconcilePermissions(agentId, sessionId, authoritative, boundary);
  }

  /**
   * Item IDs of the agent's permission and question cards that exist right now.
   *
   * Taken before recovery RPCs start so reconciliation can tell cards that
   * predate the agent's snapshot from live requests raised while it was in flight.
   */
  snapshotInteractionItemIds(agentId: string): Set<string> {
    const ids = new Set<string>();
    for (const map of [
      this.pendingPermissionKeys,
      this.offlinePermissionKeys,
      this.pendingElicitationKeys,
      this.offlineElicitationKeys
    ]) {
      for (const [key, itemId] of map) {
        if (key.startsWith(`${agentId}:`)) ids.add(itemId);
      }
    }
    return ids;
  }

  /**
   * Retire permission cards the agent no longer reports as pending.
   *
   * Only cards keyed by the agent's interaction ID take part: a fallback
   * tool-call key cannot be compared with the agent's pending IDs, so such a
   * card is left alone rather than guessed at. No outcome is ever sent.
   */
  private reconcilePermissions(
    agentId: string,
    sessionId: string,
    authoritative: Set<string>,
    boundary?: ReadonlySet<string>
  ) {
    const stale = new Set<string>();
    const collect = (entries: Iterable<[string, string]>) => {
      for (const [key, itemId] of entries) {
        if (!isInteractionKey(key, agentId) || authoritative.has(key)) continue;
        // A card created after the recovery snapshot began is newer than the agent's answer.
        if (boundary && !boundary.has(itemId)) continue;
        const item = this.items.find((candidate) => candidate.id === itemId);
        if (item && item.status !== 'resolved' && item.sessionId === sessionId) {
          stale.add(itemId);
        }
      }
    };
    collect(this.pendingPermissionKeys.entries());
    collect(this.offlinePermissionKeys.entries());

    for (const itemId of stale) {
      const live = this.pendingPermissionRequests.get(itemId);
      if (live) {
        // Drop the resolver without answering; the request no longer exists.
        this.removePendingPermission(live);
      }
      for (const [key, candidate] of [...this.offlinePermissionKeys.entries()]) {
        if (candidate === itemId) this.offlinePermissionKeys.delete(key);
      }
      this.markResolved(itemId, 'No longer pending');
    }

    // A submitted answer for an interaction the agent no longer lists was applied.
    for (const [key, itemId] of [...this.submittedPermissionKeys.entries()]) {
      if (!isInteractionKey(key, agentId) || authoritative.has(key)) continue;
      const item = this.items.find((candidate) => candidate.id === itemId);
      if (item?.sessionId === sessionId) this.submittedPermissionKeys.delete(key);
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
            // No resolver is bound until the agent re-delivers the question;
            // keep controls disabled until rebindOfflineElicitation clears this.
            offline: true,
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

    this.removePendingPermission(pending);
    this.markResolved(itemId, describePermissionResolution(option));
    if (pending.requestKey) this.submittedPermissionKeys.set(pending.requestKey, itemId);
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
    const requestKey = getPermissionRequestKey(request, agentId);

    // The agent re-delivers a still-pending request after a reconnect (or to a
    // newer delivery on the same transport). Rebind it to the existing card so
    // one question stays one card with one answer.
    const existingItemId = requestKey
      ? (this.offlinePermissionKeys.get(requestKey) ?? this.pendingPermissionKeys.get(requestKey))
      : null;
    if (existingItemId && requestKey) {
      return this.rebindPermissionRequest(existingItemId, requestKey, request, agentId);
    }

    // A re-delivery of a request we already answered means the agent kept it
    // pending (it rejected the answer). Reuse the same card, restored to pending.
    const submittedItemId = requestKey ? this.submittedPermissionKeys.get(requestKey) : null;
    if (submittedItemId && requestKey) {
      this.submittedPermissionKeys.delete(requestKey);
      return this.rebindPermissionRequest(submittedItemId, requestKey, request, agentId, true);
    }

    const itemId = `live-permission-${this.nextLiveItemId++}`;
    const item = mapPermissionRequestToInboxItem(request, itemId, agentId, agentName);
    this.items = [item, ...this.items];
    if (requestKey) this.pendingPermissionKeys.set(requestKey, itemId);
    void sendDesktopNotification(item.title, item.detail);

    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissionRequests.set(itemId, {
        itemId,
        agentId,
        requestKey,
        request,
        resolve
      });
    });
  }

  /**
   * Install the resolver of a re-delivered permission request on its card.
   *
   * An offline card becomes actionable again without a new card or desktop
   * notification. A still-live resolver for the same request belongs to a
   * superseded delivery; it is dismissed with `cancelled`, which the agent
   * treats as "not a decision" for that delivery only.
   */
  private rebindPermissionRequest(
    itemId: string,
    requestKey: string,
    request: RequestPermissionRequest,
    agentId: string,
    restoreAnswered = false
  ): Promise<RequestPermissionResponse> {
    const superseded = this.pendingPermissionRequests.get(itemId);
    if (superseded) {
      this.pendingPermissionRequests.delete(itemId);
      superseded.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.offlinePermissionKeys.delete(requestKey);
    this.pendingPermissionKeys.set(requestKey, itemId);
    this.items = this.items.map((item) => {
      if (item.id !== itemId) return item;
      if (item.status === 'resolved' && !restoreAnswered) return item;
      return {
        ...item,
        status: 'pending',
        resolution: null,
        offline: false,
        error: restoreAnswered ? 'The agent rejected this answer.' : null,
        actions: mapPermissionRequestToInboxItem(request, itemId).actions
      };
    });

    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissionRequests.set(itemId, {
        itemId,
        agentId,
        requestKey,
        request,
        resolve
      });
    });
  }

  private removePendingPermission(pending: PendingPermissionRequest) {
    this.pendingPermissionRequests.delete(pending.itemId);
    if (pending.requestKey && this.pendingPermissionKeys.get(pending.requestKey) === pending.itemId) {
      this.pendingPermissionKeys.delete(pending.requestKey);
    }
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
   * A dropped transport is not a decision: no outcome (not even `cancelled`)
   * is sent for any card. Keyed permission and question cards (and drafts)
   * stay pending but are marked offline, so a reconnection can rebind the
   * re-delivered request to the same card. Requests without a stable identity
   * can never rebind and are retired locally without any fabricated answer.
   */
  private retirePendingRequestsForAgent(agentId: string) {
    for (const pending of [...this.pendingPermissionRequests.values()]) {
      if (pending.agentId !== agentId) continue;
      this.removePendingPermission(pending);
      if (pending.requestKey) {
        this.offlinePermissionKeys.set(pending.requestKey, pending.itemId);
        this.markItemOffline(pending.itemId);
      } else {
        this.markResolved(pending.itemId, 'No longer pending');
      }
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

/** Fallback keys carry this marker so they never collide with interaction IDs. */
const TOOL_CALL_KEY_MARKER = 'tc:';

/**
 * Stable identity of a permission request. Prefers the agent's interaction ID
 * (`_meta.querymt.interaction_id`), which matches the IDs the agent lists for
 * recovery; falls back to session + tool call for an agent that omits it.
 */
function getPermissionRequestKey(request: RequestPermissionRequest, agentId: string): string | null {
  const querymtMeta = request._meta?.querymt;
  if (querymtMeta && typeof querymtMeta === 'object') {
    const interactionId = (querymtMeta as Record<string, unknown>).interaction_id;
    if (typeof interactionId === 'string' && interactionId) return `${agentId}:${interactionId}`;
  }
  const toolCallId = request.toolCall?.toolCallId;
  return typeof toolCallId === 'string' && toolCallId
    ? `${agentId}:${TOOL_CALL_KEY_MARKER}${request.sessionId}:${toolCallId}`
    : null;
}

function isInteractionKey(key: string, agentId: string): boolean {
  return key.startsWith(`${agentId}:`) && !key.startsWith(`${agentId}:${TOOL_CALL_KEY_MARKER}`);
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
