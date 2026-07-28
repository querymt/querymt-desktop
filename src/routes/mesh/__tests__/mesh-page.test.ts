import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeshPage from '../+page.svelte';

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
    refreshRemoteSessionsForAgent: vi.fn(async () => undefined),
    createMeshInvite: vi.fn(async () => ({ invite_id: 'invite-new', url: 'https://mesh.invalid/invite-new', expires_at: 0, max_uses: 1 })),
    revokeMeshInvite: vi.fn(async () => undefined),
    dismissRemoteSession: vi.fn(async () => undefined)
  };
}

const agentsStore = vi.hoisted(() => createAgentsStore());
const commandPaletteStore = vi.hoisted(() => ({
  openRemoteCreate: vi.fn(),
  openRemoteAttach: vi.fn()
}));

vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));
vi.mock('$lib/stores/command-palette.svelte', () => ({ commandPaletteStore }));

afterEach(() => cleanup());

beforeEach(() => {
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

  it('shows a page-scoped selector when multiple mesh agents are available', () => {
    agentsStore.configs = [...agentsStore.configs, { ...agentsStore.configs[0], id: 'agent-2', name: 'Second agent' }];
    agentsStore.controlCapabilitiesByAgent = { ...agentsStore.controlCapabilitiesByAgent, 'agent-2': capabilities() };

    render(MeshPage);

    expect(screen.getByLabelText('Mesh agent')).toBeInTheDocument();
  });

  it('opens node actions with selected agent and node context', async () => {
    render(MeshPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Create session on Build server' }));
    expect(commandPaletteStore.openRemoteCreate).toHaveBeenCalledWith({ agentId: 'agent-1', nodeId: 'node-1' });

    await fireEvent.click(screen.getByRole('button', { name: 'Attach session from Build server' }));
    expect(commandPaletteStore.openRemoteAttach).toHaveBeenCalledWith({ agentId: 'agent-1', nodeId: 'node-1', sessionId: null });
  });

  it('loads sessions for only the selected node', async () => {
    render(MeshPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Load sessions from Build server' }));
    expect(agentsStore.refreshRemoteSessionsForAgent).toHaveBeenCalledWith('agent-1', 'node-1');
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
  });

  it('shows a focused unavailable state without mesh-capable agents', () => {
    agentsStore.configs = [];
    agentsStore.controlCapabilitiesByAgent = {};

    render(MeshPage);

    expect(screen.getByText('Mesh is not available')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nodes' })).not.toBeInTheDocument();
  });
});
