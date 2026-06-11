import {
  Bot,
  CalendarClock,
  FolderGit2,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Network,
  Settings
} from '@lucide/svelte';
import type { Component } from 'svelte';

export const appMeta = {
  title: 'QueryMT Desktop',
  subtitle: 'Agent control center'
};

export const sectionOrder = [
  'Today',
  'Inbox',
  'Agents',
  'Sessions',
  'Workspaces',
  'Automations',
  'Mesh',
  'Settings'
] as const;

export type SectionName = (typeof sectionOrder)[number];

export const sectionIcons: Record<SectionName, Component> = {
  Today: LayoutDashboard,
  Inbox,
  Agents: Bot,
  Sessions: MessagesSquare,
  Workspaces: FolderGit2,
  Automations: CalendarClock,
  Mesh: Network,
  Settings
};
