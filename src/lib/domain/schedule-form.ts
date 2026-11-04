import { describeCronExpression } from './automations';

export type SchedulePreset = 'minutes' | 'hourly' | 'daily' | 'weekdays' | 'custom';

export const DEFAULT_SCHEDULE_TIME = '09:00';
export const DEFAULT_INTERVAL_MINUTES = 30;

/**
 * The agent only understands interval and once-at triggers today. Cron-based presets stay in
 * the form but are disabled until the agent gains a cron trigger.
 */
export const CRON_SCHEDULES_AVAILABLE = false;

export function isCronPreset(preset: SchedulePreset): boolean {
  return preset === 'daily' || preset === 'weekdays' || preset === 'custom';
}

export type IntervalInput = string | number | null | undefined;

/** Whole minutes of an interval input, or null when it is empty or not a whole number >= 1. */
export function parseIntervalMinutes(value: IntervalInput): number | null {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return null;
  const minutes = Number(text);
  return Number.isInteger(minutes) && minutes >= 1 ? minutes : null;
}

export type ScheduleTriggerPayload =
  | { type: 'interval'; seconds: number }
  | { type: 'cron'; expr: string; timezone: string };

/** Trigger in the agent's `type`-tagged wire format, or null while the inputs are incomplete. */
export function buildScheduleTrigger(input: {
  preset: SchedulePreset;
  time: string;
  customCron: string;
  minutes: IntervalInput;
  timezone: string;
}): ScheduleTriggerPayload | null {
  if (input.preset === 'hourly') return { type: 'interval', seconds: 3600 };
  if (input.preset === 'minutes') {
    const minutes = parseIntervalMinutes(input.minutes);
    return minutes ? { type: 'interval', seconds: minutes * 60 } : null;
  }
  const expr = buildCronExpression(input.preset, input.time, input.customCron);
  return expr ? { type: 'cron', expr, timezone: input.timezone } : null;
}

export function parseClockTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** Cron expression for the chosen frequency, or null while the inputs cannot form one. */
export function buildCronExpression(preset: SchedulePreset, time: string, customCron: string): string | null {
  if (preset === 'hourly') return '0 * * * *';
  if (preset === 'custom') return customCron.trim().replace(/\s+/g, ' ') || null;
  const clock = parseClockTime(time);
  if (!clock) return null;
  return `${clock.minute} ${clock.hour} * * ${preset === 'daily' ? '*' : '1-5'}`;
}

/** Shape check only; the agent stays the authority on what its scheduler accepts. */
export function validateCronExpression(expression: string): string | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length === 0) return 'Enter a cron expression.';
  if (fields.length !== 5) return 'Use five fields: minute, hour, day, month, weekday.';
  if (!fields.every((field) => /^[\w*,\-/?]+$/.test(field))) {
    return 'Fields can only contain letters, digits and * , - / ?';
  }
  return null;
}

/** Validation message for the frequency inputs, or null when they form a usable expression. */
export function scheduleFrequencyError(preset: SchedulePreset, time: string, customCron: string, minutes: IntervalInput = ''): string | null {
  if (preset === 'hourly') return null;
  if (preset === 'minutes') return parseIntervalMinutes(minutes) ? null : 'Enter a whole number of minutes (1 or more).';
  if (preset === 'custom') return validateCronExpression(customCron);
  return parseClockTime(time) ? null : 'Pick a time of day.';
}

export function describeSchedule(preset: SchedulePreset, time: string, customCron: string, minutes: IntervalInput = ''): string | null {
  if (scheduleFrequencyError(preset, time, customCron, minutes)) return null;
  if (preset === 'minutes') {
    const count = parseIntervalMinutes(minutes)!;
    return count === 1 ? 'Every minute' : `Every ${count} minutes`;
  }
  if (preset === 'hourly') return 'Every hour';
  const expression = buildCronExpression(preset, time, customCron);
  return expression ? describeCronExpression(expression) : null;
}

/** Number inputs bind to number | null in Svelte, so accept both that and text. */
export type LimitInputValue = string | number | null | undefined;

export interface ScheduleLimitsInput {
  maxRuns: LimitInputValue;
  maxSteps: LimitInputValue;
  maxCost: LimitInputValue;
}

export interface ScheduleLimits {
  max_runs?: number;
  max_steps?: number;
  max_cost_usd?: number;
}

export interface ScheduleLimitsResult {
  limits: ScheduleLimits;
  errors: Partial<Record<keyof ScheduleLimitsInput, string>>;
}

export function parseScheduleLimits(input: ScheduleLimitsInput): ScheduleLimitsResult {
  const limits: ScheduleLimits = {};
  const errors: ScheduleLimitsResult['errors'] = {};

  const asText = (raw: LimitInputValue) => (raw === null || raw === undefined ? '' : String(raw).trim());

  const whole = (raw: LimitInputValue, key: 'maxRuns' | 'maxSteps', target: 'max_runs' | 'max_steps') => {
    const text = asText(raw);
    if (!text) return;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1) errors[key] = 'Enter a whole number of 1 or more.';
    else limits[target] = value;
  };

  whole(input.maxRuns, 'maxRuns', 'max_runs');
  whole(input.maxSteps, 'maxSteps', 'max_steps');

  const cost = asText(input.maxCost);
  if (cost) {
    const value = Number(cost);
    if (!Number.isFinite(value) || value <= 0) errors.maxCost = 'Enter an amount greater than 0.';
    else limits.max_cost_usd = value;
  }

  return { limits, errors };
}

/**
 * Sessions matching every whitespace-separated term of the query against title, session id
 * or workspace path (case-insensitive), in the original order. An empty query matches all.
 */
export function filterSessions<T extends { sessionId: string; title: string; cwd: string }>(sessions: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return sessions;
  return sessions.filter((session) => {
    const haystack = `${session.title} ${session.sessionId} ${session.cwd}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function summarizeScheduleLimits(limits: ScheduleLimits): string {
  const parts: string[] = [];
  if (limits.max_runs !== undefined) parts.push(`${limits.max_runs} ${limits.max_runs === 1 ? 'run' : 'runs'}`);
  if (limits.max_steps !== undefined) parts.push(`${limits.max_steps} ${limits.max_steps === 1 ? 'step' : 'steps'}`);
  if (limits.max_cost_usd !== undefined) parts.push(`$${limits.max_cost_usd}`);
  return parts.length ? `Max ${parts.join(' · ')}` : 'No limits';
}
