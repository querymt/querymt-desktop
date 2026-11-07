import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  detectFirstRun,
  isOnboardingDone,
  loadOnboardingState,
  markOnboardingCompleted,
  markOnboardingSkipped
} from './onboarding';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data
  };
}

describe('onboarding', () => {
  it('treats a fresh install as a first run', () => {
    const store = memory();
    expect(detectFirstRun(store)).toBe(true);
    expect(store.data.has(ONBOARDING_STORAGE_KEY)).toBe(false);
  });

  it('records existing users as completed', () => {
    const store = memory({ 'querymt-desktop.recent-sessions': '[]' });
    expect(detectFirstRun(store)).toBe(false);
    expect(isOnboardingDone(loadOnboardingState(store))).toBe(true);
  });

  it('is not a first run after completing or skipping', () => {
    const completed = memory();
    markOnboardingCompleted(completed);
    expect(detectFirstRun(completed)).toBe(false);
    const skipped = memory();
    markOnboardingSkipped(skipped);
    expect(loadOnboardingState(skipped)).toMatchObject({ version: ONBOARDING_VERSION, completedAt: null });
    expect(detectFirstRun(skipped)).toBe(false);
  });

  it('ignores a corrupt value', () => {
    const store = memory({ [ONBOARDING_STORAGE_KEY]: '{not json' });
    expect(loadOnboardingState(store)).toBeNull();
    expect(detectFirstRun(store)).toBe(true);
  });

  it('re-offers onboarding for an older version', () => {
    const store = memory({ [ONBOARDING_STORAGE_KEY]: JSON.stringify({ version: 0, completedAt: '2020-01-01', skippedAt: null }) });
    expect(isOnboardingDone(loadOnboardingState(store))).toBe(false);
  });
});
