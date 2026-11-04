import type { DesktopSessionSummary } from '$lib/domain/types';
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

function clockTime(hour: string, minute: string): string | null {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Plain-language form of the cron shapes the create dialog produces; anything else stays raw. */
export function describeCronExpression(expression: string): string {
  const normalized = expression.trim().replace(/\s+/g, ' ');
  if (normalized === '0 * * * *') return 'Every hour';
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(normalized);
  const dailyTime = daily ? clockTime(daily[2], daily[1]) : null;
  if (dailyTime) return `Every day at ${dailyTime}`;
  const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(normalized);
  const weekdayTime = weekdays ? clockTime(weekdays[2], weekdays[1]) : null;
  if (weekdayTime) return `Weekdays at ${weekdayTime}`;
  return `Cron: ${expression}`;
}

export function describeIntervalSeconds(seconds: number): string {
  const unit = (count: number, name: string) => (count === 1 ? `Every ${name}` : `Every ${count} ${name}s`);
  if (seconds % 86400 === 0) return unit(seconds / 86400, 'day');
  if (seconds % 3600 === 0) return unit(seconds / 3600, 'hour');
  if (seconds % 60 === 0) return unit(seconds / 60, 'minute');
  return unit(seconds, 'second');
}

export function scheduleTriggerLabel(schedule: ScheduleInfo): string {
  const trigger = schedule.trigger as { type?: unknown; seconds?: unknown; at?: unknown } | null;
  if (trigger && typeof trigger === 'object') {
    if (trigger.type === 'interval' && typeof trigger.seconds === 'number' && trigger.seconds > 0) {
      return describeIntervalSeconds(trigger.seconds);
    }
    if (trigger.type === 'once_at' && typeof trigger.at === 'string') return `Once on ${formatTimestamp(trigger.at)}`;
  }
  const expression = scheduleTriggerExpression(schedule);
  if (!expression) return 'Scheduled automation';
  return describeCronExpression(expression);
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

/** Last two path segments, enough to recognise a workspace without the full path. */
export function compactPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length <= 2 ? path : segments.slice(-2).join('/');
}

export type ScheduleTargetSession = Pick<DesktopSessionSummary, 'title' | 'cwd'>;

/** Names the target by session title and workspace when the session is known, else by raw id. */
export function scheduleTargetLabel(schedule: ScheduleInfo, session: ScheduleTargetSession | null = null): string {
  const node = schedule.node_id ? `Node ${schedule.node_id} · ` : '';
  if (!session) return `${node}Session ${schedule.session_public_id}`;
  const workspace = session.cwd ? ` · ${compactPath(session.cwd)}` : '';
  return `${node}${session.title || 'Untitled session'}${workspace}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'None';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatTimestamp(value?: string): string {
  if (!value) return 'Unavailable';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}
