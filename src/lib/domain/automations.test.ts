import { describe, expect, it } from 'vitest';
import { classifySchedule, groupSchedules, relativeTime, scheduleTargetLabel, scheduleTimingSummary, scheduleTriggerLabel } from './automations';
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
});
