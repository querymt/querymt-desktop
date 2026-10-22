import { describe, expect, it, vi } from 'vitest';
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk';
import { InboxStore } from './inbox.svelte';

const sendDesktopNotification = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('$lib/querymt/notifications', () => ({
  sendDesktopNotification
}));

function createClient() {
  let elicitationHandler: ((request: CreateElicitationRequest) => Promise<CreateElicitationResponse>) | null = null;
  let permissionHandler: ((request: RequestPermissionRequest) => Promise<RequestPermissionResponse>) | null = null;
  let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;

  return {
    onElicitationRequest: vi.fn((handler: typeof elicitationHandler) => {
      elicitationHandler = handler;
      return () => {
        elicitationHandler = null;
      };
    }),
    onPermissionRequest: vi.fn((handler: typeof permissionHandler) => {
      permissionHandler = handler;
      return () => {
        permissionHandler = null;
      };
    }),
    onExtensionNotification: vi.fn((handler: typeof notificationHandler) => {
      notificationHandler = handler;
      return () => {
        notificationHandler = null;
      };
    }),
    elicit: (request: CreateElicitationRequest) => elicitationHandler!(request),
    permission: (request: RequestPermissionRequest) => permissionHandler!(request),
    notify: (method: string, params: unknown) => notificationHandler?.({ method, params } as never)
  };
}

function elicitation(sessionId = 'session-1', options: { keyed?: boolean } = {}): CreateElicitationRequest {
  const keyed = options.keyed ?? true;
  return {
    mode: 'form',
    sessionId,
    message: 'Choose a target',
    _meta: keyed
      ? { querymt: { elicitation_id: `elicit-${sessionId}`, source: 'builtin:question' } }
      : { querymt: { source: 'builtin:question' } },
    requestedSchema: {
      type: 'object',
      title: 'Target',
      properties: {
        selection: {
          type: 'string',
          title: 'Target',
          oneOf: [{ const: 'prod', title: 'Production' }]
        }
      },
      required: ['selection']
    }
  };
}

function permission(
  sessionId = 'session-1',
  options: { interactionId?: string; toolCallId?: string } = {}
): RequestPermissionRequest {
  return {
    sessionId,
    ...(options.interactionId
      ? { _meta: { querymt: { interaction_id: options.interactionId } } }
      : {}),
    toolCall: { toolCallId: options.toolCallId ?? 'tool-1', title: 'Run tests', kind: 'execute' },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
    ]
  };
}

describe('InboxStore elicitations', () => {
  it('filters active-session elicitations and resolves accepted content', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation());
    void client.elicit(elicitation('session-2'));

    expect(store.pendingElicitationsForSession('agent-1', 'session-1')).toHaveLength(1);
    expect(store.pendingElicitationsForSession('agent-1', 'session-2')).toHaveLength(1);

    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    await store.handleAction(item.id, 'accept');

    await expect(response).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
    expect(store.pendingElicitationsForSession('agent-1', 'session-1')).toEqual([]);
  });

  it('resolves a custom response and replaces preset selections', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation());
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];

    store.updateField(item.id, 'selection', 'prod');
    store.setCustomFieldActive(item.id, 'selection', true);
    store.updateCustomField(item.id, 'selection', '  A custom target  ');
    await store.handleAction(item.id, 'accept');

    await expect(response).resolves.toEqual({ action: 'accept', content: { selection: 'A custom target' } });
  });

  it('keeps an empty custom response pending with validation feedback', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.elicit(elicitation());
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];

    store.setCustomFieldActive(item.id, 'selection', true);
    await store.handleAction(item.id, 'accept');

    expect(store.pendingElicitationsForSession('agent-1', 'session-1')).toHaveLength(1);
    expect(store.items.find((candidate) => candidate.id === item.id)?.error).toBe('Please enter a custom response.');
  });

  it('preserves pending requests when listeners are unbound', async () => {
    const store = new InboxStore();
    const client = createClient();
    const unbind = store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation());

    unbind();

    expect(store.pendingElicitationsForSession('agent-1', 'session-1')).toHaveLength(1);
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    await store.handleAction(item.id, 'accept');
    await expect(response).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
  });

  it('retains question cards offline and retires the resolver without responding cancel', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation());
    let settled: CreateElicitationResponse | null = null;
    void response.then((value) => {
      settled = value;
    });

    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    store.disconnectAgent('agent-1');
    await Promise.resolve();
    await Promise.resolve();

    const retained = store.items.find((candidate) => candidate.id === item.id);
    expect(retained?.status).toBe('pending');
    expect(retained?.offline).toBe(true);
    expect(retained?.resolution ?? null).toBeNull();
    expect(retained?.formFields?.find((field) => field.key === 'selection')?.value).toBe('prod');
    expect(settled).toBeNull();

    await store.handleAction(item.id, 'accept');
    expect(settled).toBeNull();
    expect(store.items.find((candidate) => candidate.id === item.id)?.status).toBe('pending');
  });

  it('keeps other agents pending and actionable when one agent disconnects', async () => {
    const store = new InboxStore();
    const otherClient = createClient();
    store.bindClient(otherClient as never, 'agent-2', 'OTHER');
    const otherResponse = otherClient.elicit(elicitation());

    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.elicit(elicitation());
    store.disconnectAgent('agent-1');

    const retainedOther = store.pendingElicitationsForSession('agent-2', 'session-1')[0];
    expect(retainedOther.offline).toBeUndefined();
    store.updateField(retainedOther.id, 'selection', 'prod');
    await store.handleAction(retainedOther.id, 'accept');
    await expect(otherResponse).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
  });

  it('still answers cancel when the user explicitly cancels a live question', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation());
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];

    await store.handleAction(item.id, 'cancel');

    await expect(response).resolves.toEqual({ action: 'cancel' });
    const resolved = store.items.find((candidate) => candidate.id === item.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toBe('Cancelled');
  });

  it('answers cancel for a live duplicate question without duplicating the card', async () => {
    sendDesktopNotification.mockClear();
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.elicit(elicitation());
    const duplicate = client.elicit(elicitation());

    await expect(duplicate).resolves.toEqual({ action: 'cancel' });
    expect(store.pendingElicitationsForSession('agent-1', 'session-1')).toHaveLength(1);
    expect(sendDesktopNotification).toHaveBeenCalledTimes(1);
  });

  it('rebinds a re-delivered question to its offline card, preserving drafts', async () => {
    sendDesktopNotification.mockClear();
    const store = new InboxStore();
    const firstClient = createClient();
    store.bindClient(firstClient as never, 'agent-1', 'QMTCODE');
    const firstDelivery = firstClient.elicit(elicitation());
    let firstSettled: CreateElicitationResponse | null = null;
    void firstDelivery.then((value) => {
      firstSettled = value;
    });

    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    store.disconnectAgent('agent-1');
    expect(store.items.find((candidate) => candidate.id === item.id)?.offline).toBe(true);

    const reconnectedClient = createClient();
    store.bindClient(reconnectedClient as never, 'agent-1', 'QMTCODE');
    const redelivered = reconnectedClient.elicit(elicitation());

    const rebound = store.pendingElicitationsForSession('agent-1', 'session-1');
    expect(rebound).toHaveLength(1);
    expect(rebound[0].id).toBe(item.id);
    expect(rebound[0].offline).toBe(false);
    expect(rebound[0].formFields?.find((field) => field.key === 'selection')?.value).toBe('prod');
    expect(sendDesktopNotification).toHaveBeenCalledTimes(1);

    await store.handleAction(item.id, 'accept');

    await expect(redelivered).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSettled).toBeNull();

    const resolved = store.items.find((candidate) => candidate.id === item.id);
    expect(resolved?.status).toBe('resolved');
    // One answer only: a second action cannot re-resolve the rebound card.
    await store.handleAction(item.id, 'decline');
    expect(store.items.find((candidate) => candidate.id === item.id)?.resolution).toBe('Submitted');
  });

  it('restores a rejected custom answer and rebinds the re-delivered question to the same card', async () => {
    sendDesktopNotification.mockClear();
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const first = client.elicit(elicitation());
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];

    store.setCustomFieldActive(item.id, 'selection', true);
    store.updateCustomField(item.id, 'selection', 'my own answer');
    await store.handleAction(item.id, 'accept');
    await expect(first).resolves.toEqual({ action: 'accept', content: { selection: 'my own answer' } });
    expect(store.items.find((candidate) => candidate.id === item.id)?.status).toBe('resolved');

    client.notify('querymt/elicitation/validationFailed', {
      session_id: 'session-1',
      elicitation_id: 'elicit-session-1',
      message: 'bad content'
    });

    const restored = store.pendingElicitationsForSession('agent-1', 'session-1');
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(item.id);
    expect(restored[0].error).toContain('bad content');
    expect(restored[0].formFields?.[0].customValue).toBe('my own answer');
    // Controls stay disabled until the re-delivered question installs a resolver.
    expect(restored[0].offline).toBe(true);
    await store.handleAction(item.id, 'accept');
    expect(store.items.find((candidate) => candidate.id === item.id)?.status).toBe('pending');

    const redelivered = client.elicit(elicitation());
    const rebound = store.pendingElicitationsForSession('agent-1', 'session-1');
    expect(rebound).toHaveLength(1);
    expect(rebound[0].id).toBe(item.id);
    expect(rebound[0].offline).toBe(false);
    expect(rebound[0].error).toContain('bad content');
    expect(sendDesktopNotification).toHaveBeenCalledTimes(1);

    store.updateField(item.id, 'selection', 'prod');
    await store.handleAction(item.id, 'accept');
    await expect(redelivered).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
  });

  it('rebinds a re-delivery to a submitted card even if validationFailed is missed', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.elicit(elicitation());
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    await store.handleAction(item.id, 'accept');

    void client.elicit(elicitation());
    const rebound = store.pendingElicitationsForSession('agent-1', 'session-1');
    expect(rebound).toHaveLength(1);
    expect(rebound[0].id).toBe(item.id);
  });

  it('forgets a submitted card once the agent reports completion', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.elicit(elicitation());
    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    await store.handleAction(item.id, 'accept');

    client.notify('querymt/elicitation/completed', {
      session_id: 'session-1',
      elicitation_id: 'elicit-session-1',
      outcome: 'accept'
    });
    client.notify('querymt/elicitation/validationFailed', {
      session_id: 'session-1',
      elicitation_id: 'elicit-session-1',
      message: 'late'
    });

    expect(store.pendingElicitationsForSession('agent-1', 'session-1')).toHaveLength(0);
    expect(store.items.find((candidate) => candidate.id === item.id)?.status).toBe('resolved');
  });

  it('retires unkeyed questions on disconnect without answering them', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation('session-1', { keyed: false }));
    let settled: CreateElicitationResponse | null = null;
    void response.then((value) => {
      settled = value;
    });

    const item = store.pendingElicitationsForSession('agent-1', 'session-1')[0];
    store.updateField(item.id, 'selection', 'prod');
    store.disconnectAgent('agent-1');
    await Promise.resolve();
    await Promise.resolve();

    const retired = store.items.find((candidate) => candidate.id === item.id);
    expect(retired?.status).toBe('resolved');
    expect(retired?.resolution).toBe('No longer pending');
    expect(retired?.offline).toBeUndefined();
    expect(settled).toBeNull();
    expect(store.pendingCount).toBe(0);

    // A re-delivery cannot rebind (no stable identity) and creates a fresh card.
    const reconnectedClient = createClient();
    store.bindClient(reconnectedClient as never, 'agent-1', 'QMTCODE');
    void reconnectedClient.elicit(elicitation('session-1', { keyed: false }));
    const fresh = store.pendingElicitationsForSession('agent-1', 'session-1');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(item.id);
  });

  it('treats reconciliation in a refreshed UI with no retained cards as a no-op', () => {
    const store = new InboxStore();
    store.reconcileReboundElicitations('agent-1', 'session-1', ['elicit-session-1']);
    expect(store.items).toEqual([]);
  });
});

describe('InboxStore permission requests', () => {
  it('keeps permission cards offline on disconnect without sending any outcome', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.permission(permission());
    let settled: RequestPermissionResponse | null = null;
    void response.then((value) => {
      settled = value;
    });
    const item = store.actionableItems[0];
    expect(item).toBeDefined();

    store.disconnectAgent('agent-1');
    await Promise.resolve();
    await Promise.resolve();

    const retained = store.items.find((candidate) => candidate.id === item!.id);
    expect(retained?.status).toBe('pending');
    expect(retained?.offline).toBe(true);
    expect(retained?.resolution ?? null).toBeNull();
    expect(settled).toBeNull();
    expect(store.liveRequestCount).toBe(0);
  });

  it('rejects answers to an offline permission card', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.permission(permission());
    let settled: RequestPermissionResponse | null = null;
    void response.then((value) => {
      settled = value;
    });
    const item = store.actionableItems[0]!;
    store.disconnectAgent('agent-1');

    await store.handleAction(item.id, 'allow');
    await Promise.resolve();

    expect(settled).toBeNull();
    expect(store.items.find((candidate) => candidate.id === item.id)?.status).toBe('pending');
  });

  it('rebinds a re-delivered permission request to its offline card and answers the new request', async () => {
    sendDesktopNotification.mockClear();
    const store = new InboxStore();
    const firstClient = createClient();
    store.bindClient(firstClient as never, 'agent-1', 'QMTCODE');
    const firstDelivery = firstClient.permission(permission());
    let firstSettled: RequestPermissionResponse | null = null;
    void firstDelivery.then((value) => {
      firstSettled = value;
    });
    const item = store.actionableItems[0]!;
    store.disconnectAgent('agent-1');

    const reconnectedClient = createClient();
    store.bindClient(reconnectedClient as never, 'agent-1', 'QMTCODE');
    const redelivered = reconnectedClient.permission(permission());

    const cards = store.items.filter((candidate) => candidate.type === 'permission');
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(item.id);
    expect(cards[0].offline).toBe(false);
    expect(cards[0].actions?.map((action) => action.id)).toEqual(['allow', 'reject']);
    expect(sendDesktopNotification).toHaveBeenCalledTimes(1);

    await store.handleAction(item.id, 'allow');
    await expect(redelivered).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    await Promise.resolve();
    expect(firstSettled).toBeNull();

    // One answer only: a second action cannot re-resolve the card.
    const resolution = store.items.find((candidate) => candidate.id === item.id)?.resolution;
    expect(resolution).toBeTruthy();
    await store.handleAction(item.id, 'reject');
    expect(store.items.find((candidate) => candidate.id === item.id)?.resolution).toBe(resolution);
    expect(store.pendingCount).toBe(0);
  });

  it('does not rebind permission requests across sessions or agents', () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.permission(permission('session-1'));
    store.disconnectAgent('agent-1');

    const reconnected = createClient();
    store.bindClient(reconnected as never, 'agent-1', 'QMTCODE');
    void reconnected.permission(permission('session-2'));
    const other = createClient();
    store.bindClient(other as never, 'agent-2', 'OTHER');
    void other.permission(permission('session-1'));

    expect(store.items.filter((candidate) => candidate.type === 'permission')).toHaveLength(3);
  });

  it('dismisses a superseded live delivery when the same request is re-delivered', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const first = client.permission(permission());
    const second = client.permission(permission());

    await expect(first).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    const cards = store.actionableItems.filter((candidate) => candidate.type === 'permission');
    expect(cards).toHaveLength(1);

    await store.handleAction(cards[0].id, 'reject');
    await expect(second).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
  });

  it('retires permission requests without a tool-call id locally on disconnect', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const request = permission();
    const response = client.permission({ ...request, toolCall: { ...request.toolCall, toolCallId: '' } });
    let settled: RequestPermissionResponse | null = null;
    void response.then((value) => {
      settled = value;
    });

    store.disconnectAgent('agent-1');
    await Promise.resolve();

    expect(settled).toBeNull();
    expect(store.pendingCount).toBe(0);
  });

  it('keys cards by interaction id: same tool call with different ids stays separate', () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.permission(permission('session-1', { interactionId: 'perm-a' }));
    void client.permission(permission('session-1', { interactionId: 'perm-b' }));

    expect(store.items.filter((candidate) => candidate.type === 'permission')).toHaveLength(2);
  });

  it('rebinds by interaction id after a reconnect and falls back to the tool call without one', async () => {
    const store = new InboxStore();
    const first = createClient();
    store.bindClient(first as never, 'agent-1', 'QMTCODE');
    void first.permission(permission('session-1', { interactionId: 'perm-a' }));
    void first.permission(permission('session-1', { toolCallId: 'legacy-call' }));
    store.disconnectAgent('agent-1');

    const second = createClient();
    store.bindClient(second as never, 'agent-1', 'QMTCODE');
    void second.permission(permission('session-1', { interactionId: 'perm-a' }));
    void second.permission(permission('session-1', { toolCallId: 'legacy-call' }));

    const cards = store.items.filter((candidate) => candidate.type === 'permission');
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.offline === false)).toBe(true);
  });

  it('rebinds a re-delivery to a card whose answer the agent kept pending', async () => {
    sendDesktopNotification.mockClear();
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const first = client.permission(permission('session-1', { interactionId: 'perm-a' }));
    const item = store.actionableItems[0]!;
    await store.handleAction(item.id, 'allow');
    await expect(first).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(store.items.find((candidate) => candidate.id === item.id)?.status).toBe('resolved');

    const redelivered = client.permission(permission('session-1', { interactionId: 'perm-a' }));

    const cards = store.items.filter((candidate) => candidate.type === 'permission');
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(item.id);
    expect(cards[0].status).toBe('pending');
    expect(cards[0].offline).toBe(false);
    expect(cards[0].error).toBe('The agent rejected this answer.');
    expect(sendDesktopNotification).toHaveBeenCalledTimes(1);

    await store.handleAction(item.id, 'reject');
    await expect(redelivered).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
  });

  it('retires permission cards the agent no longer reports, without sending an outcome', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const gone = client.permission(permission('session-1', { interactionId: 'perm-gone' }));
    void client.permission(permission('session-1', { interactionId: 'perm-kept' }));
    const otherSession = client.permission(permission('session-2', { interactionId: 'perm-other' }));
    let settled: RequestPermissionResponse | null = null;
    void gone.then((value) => {
      settled = value;
    });
    let otherSettled: RequestPermissionResponse | null = null;
    void otherSession.then((value) => {
      otherSettled = value;
    });
    store.disconnectAgent('agent-1');

    store.reconcileReboundElicitations('agent-1', 'session-1', ['perm-kept']);
    await Promise.resolve();
    await Promise.resolve();

    const cards = store.items.filter((candidate) => candidate.type === 'permission');
    const byId = (id: string) => cards.find((card) => card.sessionId === id && card.status === 'pending');
    expect(cards.filter((card) => card.status === 'resolved')).toHaveLength(1);
    expect(cards.find((card) => card.status === 'resolved')?.resolution).toBe('No longer pending');
    expect(byId('session-1')?.offline).toBe(true);
    expect(byId('session-2')?.offline).toBe(true);
    expect(settled).toBeNull();
    expect(otherSettled).toBeNull();
  });

  it('does not guess at permission cards keyed only by a tool call when reconciling', () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    void client.permission(permission('session-1'));
    store.disconnectAgent('agent-1');

    store.reconcileReboundElicitations('agent-1', 'session-1', []);

    expect(store.items.find((candidate) => candidate.type === 'permission')?.status).toBe('pending');
  });

  it('retires a live permission card that the agent no longer lists', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.permission(permission('session-1', { interactionId: 'perm-gone' }));
    let settled: RequestPermissionResponse | null = null;
    void response.then((value) => {
      settled = value;
    });

    store.reconcileReboundElicitations('agent-1', 'session-1', []);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.pendingCount).toBe(0);
    expect(settled).toBeNull();
  });

  it('still resolves a chosen option on the live transport', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.permission(permission());
    const item = store.actionableItems[0]!;

    await store.handleAction(item.id, 'allow');

    await expect(response).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(store.pendingCount).toBe(0);
  });
});
