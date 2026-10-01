import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeshPage from '../+page.svelte';
import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';

function capabilities() {
  return {
    querymt_control_version: 1,
    methods: [
      'querymt/mesh/status',
      'querymt/mesh/createInvite',
      'querymt/mesh/revokeInvite',
      'querymt/remote/createSession',
      'querymt/remote/attachSession',
      'querymt/remote/sessions',
      'querymt/remote/dismissSession'
    ],
    agent: { kind: 'querymt', version: '1.0.0', display_name: 'QMT Code' },
    transport: { mesh: true, websocket: false },
    features: { models: true, schedules: true, remote_sessions: true, mesh_invites: true, auth: true, mesh: true }
  };
}

function createAgentsStore() {
  return {
    configs: [{ id: 'agent-1', name: 'QMTCODE', transport: 'stdio', commandLine: 'qmtcode', enabled: true, autoStart: true }] as Array<{ id: string; name: string; transport: string; commandLine: string; enabled: boolean; autoStart: boolean }>,
    controlCapabilitiesByAgent: { 'agent-1': capabilities() } as Record<string, ReturnType<typeof capabilities>>,
    meshStatusByAgent: {
      'agent-1': {
        enabled: true,
        peer_id: 'peer-local',
        transport: 'iroh',
        known_peer_count: 1,
        has_invite_store: true,
        has_mesh_state_store: true,
        scopes: []
      }
    },
    meshNodesByAgent: {
      'agent-1': {
        nodes: [{ id: 'node-1', label: 'Build server', capabilities: [], active_sessions: 2, transport: 'iroh', last_seen_at: 'recently' }]
      }
    },
    meshInvitesByAgent: {
      'agent-1': {
        invites: [{ invite_id: 'invite-1', mesh_name: 'Default mesh', expires_at: Math.floor(Date.now() / 1000) + 86_400, max_uses: 2, uses_remaining: 1, status: 'active', used_by: [], created_at: 0 }]
      }
    },
    remoteSessionsByAgent: {} as Record<string, Record<string, unknown>>,
    refreshMeshForAgent: vi.fn(async () => undefined),
    refreshAllSessions: vi.fn(async () => undefined),
    createMeshInvite: vi.fn(async () => ({ invite_id: 'invite-new', url: 'https://mesh.invalid/invite-new', expires_at: 0, max_uses: 1 })),
    revokeMeshInvite: vi.fn(async () => undefined)
  };
}

const agentsStore = vi.hoisted(() => createAgentsStore());

vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));

afterEach(() => {
  cleanup();
  chatPreferencesStore.setShowRemoteSessions(false);
  chatPreferencesStore.setRemoteSessionPeer('node-1', false);
});

beforeEach(() => {
  chatPreferencesStore.initialize();
  chatPreferencesStore.setShowRemoteSessions(false);
  chatPreferencesStore.setRemoteSessionPeer('node-1', false);
  Object.assign(agentsStore, createAgentsStore());
  vi.clearAllMocks();
  vi.stubGlobal('confirm', vi.fn(() => true));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe('Mesh page', () => {
  it('uses nodes as the primary object and hides a redundant single-agent selector', () => {
    render(MeshPage);

    expect(screen.queryByLabelText('Mesh agent')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nodes' })).toBeInTheDocument();
    expect(screen.getByText('Build server')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invites' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Remote sessions' })).not.toBeInTheDocument();
  });

  it('keeps compact mesh identity metadata on one copyable summary line', async () => {
    const peerId = '12D3KooWPtRjf6xSzZKwyRWP2kBA1kZhqYjr4XxEmtHfunWZUT62';
    agentsStore.meshStatusByAgent['agent-1'] = {
      ...agentsStore.meshStatusByAgent['agent-1'],
      peer_id: peerId,
      known_peer_count: 0
    };

    render(MeshPage);

    expect(screen.getByText('12D3KooWPtRj...unWZUT62')).toBeInTheDocument();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('iroh', { selector: '.mesh-overview-context-value' })).toBeInTheDocument();
    expect(screen.getByText('Known peers')).toBeInTheDocument();
    expect(screen.getByText('0', { selector: '.mesh-overview-context-count' })).toBeInTheDocument();

    const copyButton = screen.getByRole('button', { name: `Copy peer ID ${peerId}` });
    expect(copyButton).toHaveAttribute('title', peerId);
    await fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(peerId);
    expect(screen.getByRole('button', { name: 'Peer ID copied' })).toBeInTheDocument();
  });

  it('shows a page-scoped selector when multiple mesh agents are available', () => {
    agentsStore.configs = [...agentsStore.configs, { ...agentsStore.configs[0], id: 'agent-2', name: 'Second agent' }];
    agentsStore.controlCapabilitiesByAgent = { ...agentsStore.controlCapabilitiesByAgent, 'agent-2': capabilities() };

    render(MeshPage);

    expect(screen.getByLabelText('Mesh agent')).toBeInTheDocument();
  });

  it('shows compact copyable IDs for remote peers', async () => {
    const nodeId = 'r12D3KooWPtRjf6xSzZKwyRWP2kBA1kZhqYjr4XxEmtHfunWZUT62';
    agentsStore.meshNodesByAgent['agent-1'] = {
      nodes: [{ ...agentsStore.meshNodesByAgent['agent-1'].nodes[0], id: nodeId, transport: 'unknown' }]
    };

    render(MeshPage);

    expect(screen.getByText('r12D3KooWPtR...unWZUT62')).toBeInTheDocument();
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
    const copyButton = screen.getByRole('button', { name: `Copy remote peer ID ${nodeId}` });
    expect(copyButton).toHaveAttribute('title', nodeId);

    await fireEvent.click(copyButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(nodeId);
    expect(screen.getByRole('button', { name: 'Remote peer ID copied' })).toBeInTheDocument();
  });

  it('orders nodes by peer ID rather than label or discovery order', () => {
    const original = agentsStore.meshNodesByAgent['agent-1'].nodes[0];
    agentsStore.meshNodesByAgent['agent-1'] = {
      nodes: [
        { ...original, id: 'peer-z', label: 'Alpha' },
        { ...original, id: 'peer-a', label: 'Zulu' },
        { ...original, id: 'peer-m', label: 'Beta' }
      ]
    };

    render(MeshPage);

    expect(screen.getAllByRole('button', { name: /^Copy remote peer ID/ }).map((button) => button.getAttribute('title')))
      .toEqual(['peer-a', 'peer-m', 'peer-z']);
    expect(agentsStore.meshNodesByAgent['agent-1'].nodes.map((node) => node.id))
      .toEqual(['peer-z', 'peer-a', 'peer-m']);
  });

  it('shows a per-node switch only while remote sessions are enabled and preserves peer choice', async () => {
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    render(MeshPage);
    expect(screen.queryByRole('switch', { name: 'Include Build server in Sessions' })).not.toBeInTheDocument();

    chatPreferencesStore.setShowRemoteSessions(true);
    const inclusion = await screen.findByRole('switch', { name: 'Include Build server in Sessions' });
    expect(inclusion).toHaveAttribute('aria-checked', 'true');
    await fireEvent.click(inclusion);
    expect(chatPreferencesStore.remoteSessionPeers).not.toContain('node-1');
    expect(agentsStore.refreshAllSessions).toHaveBeenCalledOnce();

    chatPreferencesStore.setShowRemoteSessions(false);
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Include Build server in Sessions' })).not.toBeInTheDocument());
    chatPreferencesStore.setShowRemoteSessions(true);
    expect(await screen.findByRole('switch', { name: 'Include Build server in Sessions' })).toHaveAttribute('aria-checked', 'false');
  });

  it('explains how to enable remote session inclusion when it is disabled', async () => {
    render(MeshPage);

    const info = screen.getByRole('button', { name: 'About enabling remote sessions' });
    expect(screen.queryByRole('switch', { name: 'Include Build server in Sessions' })).not.toBeInTheDocument();
    await fireEvent.pointerEnter(info);
    expect(await screen.findByText('To include sessions from remote hosts in the Sessions list, enable Show remote sessions in Settings.')).toBeInTheDocument();

    chatPreferencesStore.setShowRemoteSessions(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'About enabling remote sessions' })).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'Include Build server in Sessions' })).toBeInTheDocument();
  });

  it('explains the per-host inclusion switch on info icon hover', async () => {
    chatPreferencesStore.setShowRemoteSessions(true);
    render(MeshPage);

    expect(screen.getByText('Include', { selector: '.mesh-node-inclusion span' })).toBeInTheDocument();
    const info = screen.getByRole('button', { name: 'About including sessions from Build server' });
    await fireEvent.pointerEnter(info);
    expect(await screen.findByText('Include sessions from remote host Build server in the Sessions list.')).toBeInTheDocument();
  });

  it('does not expose or fetch remote sessions within Mesh', () => {
    agentsStore.remoteSessionsByAgent = {
      'agent-1': {
        'node-1': {
          node_id: 'node-1', total_count: 1,
          sessions: [{ id: 'remote-session-1', node_id: 'node-1', title: 'Review the deployment' }]
        }
      }
    };
    chatPreferencesStore.setShowRemoteSessions(true);
    render(MeshPage);

    expect(screen.queryByText('Review the deployment')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create session on Build server' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach session from Build server' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load sessions from Build server' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create remote session' })).not.toBeInTheDocument();
  });

  it('keeps invite management available without remote session controls', () => {
    render(MeshPage);

    expect(screen.queryByRole('button', { name: 'Create remote session' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create mesh invite' })).not.toHaveClass('icon-btn-primary');
    expect(screen.getByRole('button', { name: 'Revoke invite-1' })).toHaveClass('icon-btn-danger');
    expect(screen.queryByLabelText('More actions for invite invite-1')).not.toBeInTheDocument();
  });

  it('creates invites in a focused dialog and shows the share result', async () => {
    render(MeshPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Create mesh invite' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Create mesh invite');
    expect(screen.getByLabelText('Maximum invite uses')).toHaveValue(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() => expect(agentsStore.createMeshInvite).toHaveBeenCalledWith('agent-1', { ttl: '24h', max_uses: 1 }));
    expect(await screen.findByText('Invite ready')).toBeInTheDocument();
    expect(screen.getByText('invite-new')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  });

  it('shows a focused unavailable state without mesh-capable agents', () => {
    agentsStore.configs = [];
    agentsStore.controlCapabilitiesByAgent = {};

    render(MeshPage);

    expect(screen.getByText('Mesh is not available')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nodes' })).not.toBeInTheDocument();
  });
});
