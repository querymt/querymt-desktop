const STORAGE_KEY = 'querymt.schedule.timezone';

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function systemTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** IANA zone names for the picker; always contains UTC and the system zone. */
export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = new Set<string>(supported ? supported('timeZone') : []);
  zones.add('UTC');
  zones.add(systemTimeZone());
  return [...zones].sort((a, b) => a.localeCompare(b));
}

/** The zone the user picked last time, falling back to the system zone. */
export function loadScheduleTimeZone(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved && isValidTimeZone(saved)) return saved;
  } catch {
    // Storage can be unavailable (private mode); fall through to the system zone.
  }
  return systemTimeZone();
}

export function saveScheduleTimeZone(zone: string, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  if (!isValidTimeZone(zone)) return;
  try {
    storage?.setItem(STORAGE_KEY, zone);
  } catch {
    // Not being able to remember the choice is not worth surfacing.
  }
}
