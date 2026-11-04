import { describe, expect, it } from 'vitest';
import {
  buildCronExpression,
  buildScheduleTrigger,
  parseIntervalMinutes,
  describeSchedule,
  filterSessions,
  parseClockTime,
  parseScheduleLimits,
  scheduleFrequencyError,
  summarizeScheduleLimits,
  validateCronExpression
} from './schedule-form';

describe('schedule form', () => {
  it('builds triggers in the agent wire format', () => {
    const base = { time: '07:30', customCron: '', minutes: 30, timezone: 'Europe/Berlin' };
    expect(buildScheduleTrigger({ ...base, preset: 'hourly' })).toEqual({ type: 'interval', seconds: 3600 });
    expect(buildScheduleTrigger({ ...base, preset: 'minutes', minutes: '45' })).toEqual({ type: 'interval', seconds: 2700 });
    expect(buildScheduleTrigger({ ...base, preset: 'minutes', minutes: 0 })).toBeNull();
    expect(buildScheduleTrigger({ ...base, preset: 'weekdays' })).toEqual({ type: 'cron', expr: '30 7 * * 1-5', timezone: 'Europe/Berlin' });
    expect(parseIntervalMinutes(1.5)).toBeNull();
    expect(describeSchedule('minutes', '', '', 1)).toBe('Every minute');
    expect(describeSchedule('minutes', '', '', 20)).toBe('Every 20 minutes');
    expect(scheduleFrequencyError('minutes', '', '', '')).toMatch(/whole number/);
  });

  it('parses clock times strictly', () => {
    expect(parseClockTime('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseClockTime('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseClockTime('24:00')).toBeNull();
    expect(parseClockTime('12:60')).toBeNull();
    expect(parseClockTime('')).toBeNull();
  });

  it('builds cron expressions from presets and the chosen time', () => {
    expect(buildCronExpression('hourly', '09:00', '')).toBe('0 * * * *');
    expect(buildCronExpression('daily', '07:45', '')).toBe('45 7 * * *');
    expect(buildCronExpression('weekdays', '18:00', '')).toBe('0 18 * * 1-5');
    expect(buildCronExpression('custom', '09:00', '  15  8 * *   2 ')).toBe('15 8 * * 2');
    expect(buildCronExpression('daily', '', '')).toBeNull();
    expect(buildCronExpression('custom', '09:00', '   ')).toBeNull();
  });

  it('validates the shape of a custom cron expression', () => {
    expect(validateCronExpression('')).toBe('Enter a cron expression.');
    expect(validateCronExpression('* * * *')).toMatch(/five fields/);
    expect(validateCronExpression('* * * * $')).toMatch(/can only contain/);
    expect(validateCronExpression('*/5 9-17 * * 1,3')).toBeNull();
  });

  it('reports frequency errors per preset', () => {
    expect(scheduleFrequencyError('hourly', '', '')).toBeNull();
    expect(scheduleFrequencyError('daily', '', '')).toBe('Pick a time of day.');
    expect(scheduleFrequencyError('weekdays', '08:00', '')).toBeNull();
    expect(scheduleFrequencyError('custom', '', 'nope')).toMatch(/five fields/);
  });

  it('describes the schedule in plain language', () => {
    expect(describeSchedule('hourly', '09:00', '')).toBe('Every hour');
    expect(describeSchedule('daily', '07:45', '')).toBe('Every day at 07:45');
    expect(describeSchedule('weekdays', '18:00', '')).toBe('Weekdays at 18:00');
    expect(describeSchedule('custom', '09:00', '15 8 * * 2')).toBe('Cron: 15 8 * * 2');
    expect(describeSchedule('custom', '09:00', 'bad')).toBeNull();
  });

  it('parses limits and reports invalid values per field', () => {
    expect(parseScheduleLimits({ maxRuns: '', maxSteps: '', maxCost: '' })).toEqual({ limits: {}, errors: {} });
    expect(parseScheduleLimits({ maxRuns: '5', maxSteps: '40', maxCost: '1.5' }).limits).toEqual({ max_runs: 5, max_steps: 40, max_cost_usd: 1.5 });

    const { limits, errors } = parseScheduleLimits({ maxRuns: '0', maxSteps: '2.5', maxCost: 'abc' });
    expect(limits).toEqual({});
    expect(Object.keys(errors).sort()).toEqual(['maxCost', 'maxRuns', 'maxSteps']);
    expect(parseScheduleLimits({ maxRuns: '', maxSteps: '', maxCost: '-1' }).errors.maxCost).toBeDefined();
    // Svelte binds number inputs to numbers, or null when empty.
    expect(parseScheduleLimits({ maxRuns: 5, maxSteps: null, maxCost: 0.5 })).toEqual({ limits: { max_runs: 5, max_cost_usd: 0.5 }, errors: {} });
    expect(parseScheduleLimits({ maxRuns: 0, maxSteps: undefined, maxCost: null }).errors.maxRuns).toBeDefined();
  });

  it('filters sessions by title, id and workspace with every term required', () => {
    const sessions = [
      { sessionId: 'abc-123', title: 'Nightly review', cwd: '/home/me/querymt' },
      { sessionId: 'def-456', title: 'Release notes', cwd: '/srv/docs' }
    ];
    expect(filterSessions(sessions, '')).toBe(sessions);
    expect(filterSessions(sessions, 'NIGHTLY').map((s) => s.sessionId)).toEqual(['abc-123']);
    expect(filterSessions(sessions, 'def-4').map((s) => s.sessionId)).toEqual(['def-456']);
    expect(filterSessions(sessions, 'docs release').map((s) => s.sessionId)).toEqual(['def-456']);
    expect(filterSessions(sessions, 'docs nightly')).toEqual([]);
  });

  it('summarizes limits for the collapsed disclosure', () => {
    expect(summarizeScheduleLimits({})).toBe('No limits');
    expect(summarizeScheduleLimits({ max_runs: 1 })).toBe('Max 1 run');
    expect(summarizeScheduleLimits({ max_runs: 5, max_steps: 40, max_cost_usd: 2 })).toBe('Max 5 runs \u00b7 40 steps \u00b7 $2');
  });
});
