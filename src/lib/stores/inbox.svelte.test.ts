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
    elicit: (request: CreateElicitationRequest) => elicitationHandler!(request),
    permission: (request: RequestPermissionRequest) => permissionHandler!(request)
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

function permission(sessionId = 'session-1'): RequestPermissionRequest {
  return {
    sessionId,
    toolCall: { toolCallId: 'tool-1', title: 'Run tests', kind: 'execute' },
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
});

describe('InboxStore permission requests', () => {
  it('settles permission requests as cancelled on disconnect instead of leaving them offline', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.permission(permission());
    const item = store.actionableItems[0];
    expect(item).toBeDefined();

    store.disconnectAgent('agent-1');

    await expect(response).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    const resolved = store.items.find((candidate) => candidate.id === item!.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toBe('Cancelled');
    expect(resolved?.offline).toBeUndefined();
    expect(store.pendingCount).toBe(0);
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
