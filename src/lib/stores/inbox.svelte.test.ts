import { describe, expect, it, vi } from 'vitest';
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk';
import { InboxStore } from './inbox.svelte';

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

function elicitation(sessionId = 'session-1'): CreateElicitationRequest {
  return {
    mode: 'form',
    sessionId,
    message: 'Choose a target',
    _meta: { querymt: { elicitation_id: `elicit-${sessionId}`, source: 'builtin:question' } },
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

  it('cancels pending requests on an explicit agent disconnect', async () => {
    const store = new InboxStore();
    const client = createClient();
    store.bindClient(client as never, 'agent-1', 'QMTCODE');
    const response = client.elicit(elicitation());

    store.disconnectAgent('agent-1');

    await expect(response).resolves.toEqual({ action: 'cancel' });
    expect(store.pendingCount).toBe(0);
  });
});
