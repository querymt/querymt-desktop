import type {
  InboxItem,
  RuntimeCard,
  SessionItem,
  SettingsGroup,
  TimelineEvent,
  WorkspaceItem
} from '$lib/domain/types';

export const todaySummary = {
  activeRuns: 4,
  pendingApprovals: 3,
  completedToday: 11,
  failedJobs: 1
};

export const runtimeCards: RuntimeCard[] = [
  {
    id: 'rt-ios-review',
    name: 'iOS Review Agent',
    profile: 'code-review',
    workspace: 'mobile-app',
    model: 'claude-sonnet',
    status: 'running',
    activeSessions: 2,
    lastActivity: '2 min ago'
  },
  {
    id: 'rt-research',
    name: 'Research Assistant',
    profile: 'web-research',
    workspace: 'strategy-notes',
    model: 'gpt-5',
    status: 'degraded',
    activeSessions: 1,
    lastActivity: '9 min ago'
  },
  {
    id: 'rt-ops',
    name: 'Ops Triage',
    profile: 'incident-response',
    workspace: 'platform',
    model: 'o3',
    status: 'starting',
    activeSessions: 0,
    lastActivity: 'Starting now'
  }
];

export const sessionItems: SessionItem[] = [
  {
    id: 'sess-1',
    title: 'Fix flaky sync tests',
    runtime: 'iOS Review Agent',
    workspace: 'mobile-app',
    status: 'active',
    lastMessage: 'Investigating intermittent network mocks.',
    updatedAt: 'Just now'
  },
  {
    id: 'sess-2',
    title: 'Draft launch competitor memo',
    runtime: 'Research Assistant',
    workspace: 'strategy-notes',
    status: 'waiting',
    lastMessage: 'Waiting for provider re-authentication.',
    updatedAt: '12 min ago'
  },
  {
    id: 'sess-3',
    title: 'Summarize provider outage',
    runtime: 'Ops Triage',
    workspace: 'platform',
    status: 'completed',
    lastMessage: 'Final timeline posted to incident channel.',
    updatedAt: '48 min ago'
  }
];

export const timelineEvents: TimelineEvent[] = [
  {
    id: 'event-1',
    title: 'Permission requested',
    detail: 'Approve local git commit for mobile-app release branch.',
    when: '3 min ago',
    kind: 'approval'
  },
  {
    id: 'event-2',
    title: 'Run completed',
    detail: 'Ops Triage posted an outage summary with impacted endpoints.',
    when: '21 min ago',
    kind: 'completion'
  },
  {
    id: 'event-3',
    title: 'Connection degraded',
    detail: 'Research Assistant lost provider auth and needs attention.',
    when: '27 min ago',
    kind: 'warning'
  }
];

export const inboxItems: InboxItem[] = [
  {
    id: 'inbox-1',
    title: 'Review delegated patch',
    detail: 'A background agent prepared a fix for sync retries.',
    owner: 'iOS Review Agent',
    severity: 'medium',
    type: 'review'
  },
  {
    id: 'inbox-2',
    title: 'Grant shell command',
    detail: 'Allow `npm test` in mobile-app workspace.',
    owner: 'Ops Triage',
    severity: 'high',
    type: 'permission'
  },
  {
    id: 'inbox-3',
    title: 'Provider login expired',
    detail: 'Reconnect Anthropic credentials for research flows.',
    owner: 'Research Assistant',
    severity: 'high',
    type: 'auth'
  }
];

export const workspaceItems: WorkspaceItem[] = [
  {
    id: 'ws-mobile',
    name: 'mobile-app',
    path: '~/src/mobile-app',
    status: 'indexed',
    defaultRuntime: 'iOS Review Agent'
  },
  {
    id: 'ws-platform',
    name: 'platform',
    path: '~/src/platform',
    status: 'indexing',
    defaultRuntime: 'Ops Triage'
  },
  {
    id: 'ws-notes',
    name: 'strategy-notes',
    path: '~/docs/strategy-notes',
    status: 'attention',
    defaultRuntime: 'Research Assistant'
  }
];

export const settingsGroups: SettingsGroup[] = [
  {
    title: 'Providers',
    description: 'Authentication and model routing status.',
    items: [
      { label: 'Anthropic', value: 'Needs re-auth', hint: 'Used by research profile' },
      { label: 'OpenAI', value: 'Connected', hint: 'Default fallback provider' }
    ]
  },
  {
    title: 'Desktop',
    description: 'Native integration defaults.',
    items: [
      { label: 'Notifications', value: 'Enabled', hint: 'Inbox and approvals only' },
      { label: 'Workspace picker', value: 'Prompt on first run', hint: 'Last used path remembered' }
    ]
  }
];
