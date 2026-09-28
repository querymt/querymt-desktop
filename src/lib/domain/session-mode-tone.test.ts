import { describe, expect, it } from 'vitest';
import type { SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption } from '@agentclientprotocol/sdk';
import { getSessionContextTone, SESSION_CONTEXT_TONE_COUNT } from './session-mode-tone';

function modeOption(values: string[], currentValue?: string): SessionConfigOption {
  return {
    id: 'mode',
    name: 'Mode',
    type: 'select',
    currentValue: currentValue ?? values[0],
    options: values.map((value) => ({ value, name: value }))
  } as SessionConfigOption;
}

function groupedModeOption(groups: string[][], currentValue: string): SessionConfigOption {
  const options: Array<SessionConfigSelectOption | SessionConfigSelectGroup> = groups.map((values, index) => ({
    group: `group-${index}`,
    name: `Group ${index}`,
    options: values.map((value) => ({ value, name: value }))
  }));
  return {
    id: 'mode',
    name: 'Mode',
    type: 'select',
    currentValue,
    options
  } as SessionConfigOption;
}

describe('getSessionContextTone', () => {
  it('returns null when the session exposes no mode information', () => {
    expect(getSessionContextTone([], 'build')).toBeNull();
    expect(getSessionContextTone(undefined, 'build')).toBeNull();
    expect(getSessionContextTone([modeOption(['build'])], '')).toBeNull();
    expect(getSessionContextTone([modeOption(['build'])], null)).toBeNull();
    expect(getSessionContextTone(null, null)).toBeNull();
  });

  it('keeps the default accent for sessions without a mode selector', () => {
    const options = [
      { id: 'model', name: 'Model', type: 'select', currentValue: 'sol', options: [{ value: 'sol', name: 'Sol' }] }
    ] as SessionConfigOption[];
    expect(getSessionContextTone(options, 'build')).toBeNull();
  });

  it('assigns the first advertised mode the first tone', () => {
    expect(getSessionContextTone([modeOption(['yolo'])], 'yolo')).toBe(0);
  });

  it('assigns distinct tones per advertised mode for three and five mode agents', () => {
    const three = modeOption(['build', 'plan', 'review']);
    expect(getSessionContextTone([three], 'build')).toBe(0);
    expect(getSessionContextTone([three], 'plan')).toBe(1);
    expect(getSessionContextTone([three], 'review')).toBe(2);

    const five = modeOption(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
    expect(getSessionContextTone([five], 'alpha')).toBe(0);
    expect(getSessionContextTone([five], 'bravo')).toBe(1);
    expect(getSessionContextTone([five], 'charlie')).toBe(2);
    expect(getSessionContextTone([five], 'delta')).toBe(3);
    expect(getSessionContextTone([five], 'echo')).toBe(4);
  });

  it('cycles the palette when an agent advertises more modes than tones', () => {
    const values = Array.from({ length: SESSION_CONTEXT_TONE_COUNT + 2 }, (_, index) => `mode-${index}`);
    const option = modeOption(values, values[values.length - 1]);

    const tones = values.map((value) => getSessionContextTone([option], value));
    expect(tones).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    expect(new Set(tones).size).toBe(SESSION_CONTEXT_TONE_COUNT);
  });

  it('flattens grouped mode choices in declaration order', () => {
    const option = groupedModeOption([['fast', 'safe'], ['wild']], 'wild');
    expect(getSessionContextTone([option], 'fast')).toBe(0);
    expect(getSessionContextTone([option], 'safe')).toBe(1);
    expect(getSessionContextTone([option], 'wild')).toBe(2);
  });

  it('falls back to a stable hash tone for unadvertised current modes', () => {
    const option = modeOption(['build', 'plan'], 'plan');

    const first = getSessionContextTone([option], 'mystery-mode');
    const second = getSessionContextTone([option], 'mystery-mode');
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(SESSION_CONTEXT_TONE_COUNT);
  });

  it('produces in-range tones for arbitrary opaque mode ids', () => {
    const option = modeOption(['build', 'plan', 'review'], '');
    for (const id of ['wegwart', 'deep-thought', 'モード', 'x', 'mode_9_with_long_suffix']) {
      const tone = getSessionContextTone([option], id);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(SESSION_CONTEXT_TONE_COUNT);
    }
  });
});
