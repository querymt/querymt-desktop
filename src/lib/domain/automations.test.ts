import { describe, expect, it } from 'vitest';
import {
  classifySchedule,
  compactPath,
  describeCronExpression,
  formatDuration,
  formatTimestamp,
  groupSchedules,
  relativeTime,
  scheduleTargetLabel,
  scheduleTimingSummary,
  scheduleTriggerLabel
} from './automations';
import type { ScheduleInfo } from '$lib/querymt/generated/types';

function schedule(overrides: Partial<ScheduleInfo> = {}): ScheduleInfo {
  return {
    public_id: 'schedule-1',
    task_public_id: 'task-1',
    session_public_id: 'session-1',
    trigger: { kind: 'cron', expr: '0 * * * *' },
    state: 'active',
    run_count: 0,
    consecutive_failures: 0,
    max_runtime_seconds: 300,
    created_at: '2026-07-28T00:00:00Z',
    updated_at: '2026-07-28T00:00:00Z',
    ...overrides
  };
}

describe('automation presentation', () => {
  it('classifies failures before paused or terminal states', () => {
    expect(classifySchedule(schedule({ state: 'paused', consecutive_failures: 2 }))).toBe('attention');
    expect(classifySchedule(schedule({ state: 'paused' }))).toBe('paused');
    expect(classifySchedule(schedule({ state: 'completed' }))).toBe('completed');
    expect(classifySchedule(schedule({ run_count: 3, max_runs: 3 }))).toBe('completed');
    expect(classifySchedule(schedule())).toBe('active');
  });

  it('orders status groups by urgency and schedules within each group', () => {
    const groups = groupSchedules([
      schedule({ public_id: 'active-late', next_run_at: '2026-07-29T12:00:00Z' }),
      schedule({ public_id: 'paused', state: 'paused' }),
      schedule({ public_id: 'attention-low', consecutive_failures: 1 }),
      schedule({ public_id: 'active-soon', next_run_at: '2026-07-28T12:00:00Z' }),
      schedule({ public_id: 'attention-high', consecutive_failures: 4 })
    ]);

    expect(groups.map((group) => group.id)).toEqual(['attention', 'active', 'paused']);
    expect(groups[0].schedules.map((item) => item.public_id)).toEqual(['attention-high', 'attention-low']);
    expect(groups[1].schedules.map((item) => item.public_id)).toEqual(['active-soon', 'active-late']);
  });

  it('formats known and custom cron expressions', () => {
    expect(scheduleTriggerLabel(schedule())).toBe('Every hour');
    expect(scheduleTriggerLabel(schedule({ trigger: { kind: 'cron', expr: '0 9 * * *' } }))).toBe('Every day at 09:00');
    expect(scheduleTriggerLabel(schedule({ trigger: { kind: 'cron', expr: '15 8 * * 2' } }))).toBe('Cron: 15 8 * * 2');
  });

  it('formats timing and target summaries', () => {
    const now = Date.parse('2026-07-28T10:00:00Z');
    expect(relativeTime('2026-07-28T12:00:00Z', now)).toBe('in 2h');
    expect(scheduleTimingSummary(schedule({ next_run_at: '2026-07-28T12:00:00Z' }), now)).toBe('Next run in 2h');
    expect(scheduleTimingSummary(schedule({ consecutive_failures: 2 }), now)).toBe('2 consecutive failures');
    expect(scheduleTargetLabel(schedule({ node_id: 'node-1' }))).toBe('Node node-1 · Session session-1');
  });

  it('describes cron expressions the create dialog can produce', () => {
    expect(describeCronExpression('0 * * * *')).toBe('Every hour');
    expect(describeCronExpression('30 7 * * *')).toBe('Every day at 07:30');
    expect(describeCronExpression('0 18 * * 1-5')).toBe('Weekdays at 18:00');
    expect(describeCronExpression('0 25 * * *')).toBe('Cron: 0 25 * * *');
    expect(describeCronExpression('15 8 * * 2')).toBe('Cron: 15 8 * * 2');
  });

  it('labels interval and once-at triggers', () => {
    expect(scheduleTriggerLabel(schedule({ trigger: { type: 'interval', seconds: 2700 } }))).toBe('Every 45 minutes');
    expect(scheduleTriggerLabel(schedule({ trigger: { type: 'interval', seconds: 3600 } }))).toBe('Every hour');
    expect(scheduleTriggerLabel(schedule({ trigger: { type: 'interval', seconds: 172800 } }))).toBe('Every 2 days');
    expect(scheduleTriggerLabel(schedule({ trigger: { type: 'once_at', at: '2026-07-28T00:00:00Z' } }))).toMatch(/^Once on /);
  });

  it('names the target by session title and compact workspace when known', () => {
    const known = { title: 'Nightly review', cwd: '/home/me/projects/querymt' };
    expect(scheduleTargetLabel(schedule(), known)).toBe('Nightly review · projects/querymt');
    expect(scheduleTargetLabel(schedule({ node_id: 'n1' }), { title: '', cwd: '' })).toBe('Node n1 · Untitled session');
    expect(compactPath('/a')).toBe('/a');
    expect(compactPath('/a/b/c')).toBe('b/c');
  });

  it('formats durations and timestamps for the details panel', () => {
    expect(formatDuration(0)).toBe('None');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatTimestamp(undefined)).toBe('Unavailable');
    expect(formatTimestamp('not a date')).toBe('not a date');
    expect(formatTimestamp('2026-07-28T00:00:00Z')).not.toBe('2026-07-28T00:00:00Z');
  });
});
