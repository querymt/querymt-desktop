export const ONBOARDING_STORAGE_KEY = 'querymt-desktop.onboarding';
export const ONBOARDING_VERSION = 1;

/** Keys whose presence means the desktop was used before onboarding existed. */
export const EXISTING_USER_KEYS = [
  'querymt-desktop.agents',
  'querymt-desktop.recent-sessions',
  'querymt-desktop.recent-models',
  'querymt-desktop.workspaces'
] as const;

export interface OnboardingState {
  version: number;
  completedAt: string | null;
  skippedAt: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadOnboardingState(store: StorageLike | null = storage()): OnboardingState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number') return null;
    return {
      version: parsed.version,
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      skippedAt: typeof parsed.skippedAt === 'string' ? parsed.skippedAt : null
    };
  } catch {
    return null;
  }
}

function save(state: OnboardingState, store: StorageLike | null) {
  try {
    store?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: onboarding is offered again next launch, which is harmless.
  }
}

export function isOnboardingDone(state: OnboardingState | null): boolean {
  return Boolean(state && state.version >= ONBOARDING_VERSION && (state.completedAt || state.skippedAt));
}

export function markOnboardingCompleted(store: StorageLike | null = storage(), now = new Date()) {
  save({ version: ONBOARDING_VERSION, completedAt: now.toISOString(), skippedAt: null }, store);
}

export function markOnboardingSkipped(store: StorageLike | null = storage(), now = new Date()) {
  save({ version: ONBOARDING_VERSION, completedAt: null, skippedAt: now.toISOString() }, store);
}

/**
 * Decides once per app start whether this is a first run. Must run before the
 * agents store initializes, so startup writes cannot hide a fresh install.
 * Existing users without onboarding state are recorded as completed.
 */
export function detectFirstRun(store: StorageLike | null = storage(), now = new Date()): boolean {
  if (!store) return false;
  if (isOnboardingDone(loadOnboardingState(store))) return false;
  let existing = false;
  try {
    existing = EXISTING_USER_KEYS.some((key) => store.getItem(key) !== null);
  } catch {
    return false;
  }
  if (existing) {
    markOnboardingCompleted(store, now);
    return false;
  }
  return true;
}
