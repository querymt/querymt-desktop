import type { ScheduleInfo } from '$lib/querymt/generated/types';

export type AutomationGroupId = 'attention' | 'active' | 'paused' | 'completed';

export interface AutomationGroup {
  id: AutomationGroupId;
  label: string;
  schedules: ScheduleInfo[];
}

const terminalStates = new Set(['completed', 'complete', 'finished', 'cancelled', 'canceled', 'deleted', 'disabled']);
const pausedStates = new Set(['paused', 'suspended']);

export function classifySchedule(schedule: ScheduleInfo): AutomationGroupId {
  const state = schedule.state.toLowerCase();
  if (schedule.consecutive_failures > 0 || state.includes('fail') || state.includes('error')) return 'attention';
  if (pausedStates.has(state)) return 'paused';
  if (terminalStates.has(state) || (schedule.max_runs !== undefined && schedule.run_count >= schedule.max_runs)) return 'completed';
  return 'active';
}

function timestamp(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function groupSchedules(schedules: ScheduleInfo[]): AutomationGroup[] {
  const grouped: Record<AutomationGroupId, ScheduleInfo[]> = {
    attention: [],
    active: [],
    paused: [],
    completed: []
  };

  for (const schedule of schedules) grouped[classifySchedule(schedule)].push(schedule);

  grouped.attention.sort((a, b) => b.consecutive_failures - a.consecutive_failures || timestamp(b.updated_at) - timestamp(a.updated_at));
  grouped.active.sort((a, b) => timestamp(a.next_run_at) - timestamp(b.next_run_at));
  grouped.paused.sort((a, b) => timestamp(b.updated_at) - timestamp(a.updated_at));
  grouped.completed.sort((a, b) => timestamp(b.updated_at) - timestamp(a.updated_at));

  const groups: AutomationGroup[] = [
    { id: 'attention', label: 'Needs attention', schedules: grouped.attention },
    { id: 'active', label: 'Active', schedules: grouped.active },
    { id: 'paused', label: 'Paused', schedules: grouped.paused },
    { id: 'completed', label: 'Completed', schedules: grouped.completed }
  ];
  return groups.filter((group) => group.schedules.length > 0);
}

export function scheduleTriggerExpression(schedule: ScheduleInfo): string | null {
  const trigger = schedule.trigger;
  if (!trigger || typeof trigger !== 'object') return null;
  const expression = 'expr' in trigger ? trigger.expr : 'cron' in trigger ? trigger.cron : null;
  return typeof expression === 'string' ? expression : null;
}

export function scheduleTriggerLabel(schedule: ScheduleInfo): string {
  const expression = scheduleTriggerExpression(schedule);
  if (!expression) return 'Scheduled automation';
  if (expression === '0 * * * *') return 'Every hour';
  if (expression === '0 9 * * *') return 'Every day at 09:00';
  if (expression === '0 9 * * 1-5') return 'Weekdays at 09:00';
  return `Cron: ${expression}`;
}

export function relativeTime(value?: string, now = Date.now()): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;

  const delta = parsed - now;
  const future = delta > 0;
  const absolute = Math.abs(delta);
  const minutes = Math.max(1, Math.round(absolute / 60_000));
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

export function scheduleTimingSummary(schedule: ScheduleInfo, now = Date.now()): string {
  if (schedule.consecutive_failures > 0) {
    return `${schedule.consecutive_failures} consecutive ${schedule.consecutive_failures === 1 ? 'failure' : 'failures'}`;
  }
  const group = classifySchedule(schedule);
  if (group === 'paused') {
    const lastRun = relativeTime(schedule.last_run_at, now);
    return lastRun ? `Paused · last ran ${lastRun}` : 'Paused';
  }
  if (group === 'completed') return 'Completed';
  const nextRun = relativeTime(schedule.next_run_at, now);
  return nextRun ? `Next run ${nextRun}` : 'Next run unavailable';
}

export function scheduleTargetLabel(schedule: ScheduleInfo): string {
  return `${schedule.node_id ? `Node ${schedule.node_id} · ` : ''}Session ${schedule.session_public_id}`;
}
