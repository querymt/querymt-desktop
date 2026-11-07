/** localStorage key prefixes owned by the desktop app. */
export const DESKTOP_STORAGE_PREFIXES = ['querymt-desktop.', 'querymt.'] as const;

export interface AppResetOptions {
  /** Also delete profiles managed by the desktop. */
  includeProfiles: boolean;
}

type StorageLike = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/** Removes only the desktop app's own keys and returns how many were removed. */
export function clearDesktopLocalStorage(storage: StorageLike): number {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && DESKTOP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}
