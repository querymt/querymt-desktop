export function isMacPlatform(navigatorLike: Pick<Navigator, 'platform' | 'userAgent'> | null = typeof navigator === 'undefined' ? null : navigator): boolean {
  if (!navigatorLike) return false;

  return /mac|iphone|ipad|ipod/i.test(`${navigatorLike.platform ?? ''} ${navigatorLike.userAgent ?? ''}`);
}

export function getPrimaryModifierLabel(navigatorLike?: Pick<Navigator, 'platform' | 'userAgent'> | null): 'Cmd' | 'Ctrl' {
  return isMacPlatform(navigatorLike === undefined ? (typeof navigator === 'undefined' ? null : navigator) : navigatorLike) ? 'Cmd' : 'Ctrl';
}

export function formatShortcut(keys: string, navigatorLike?: Pick<Navigator, 'platform' | 'userAgent'> | null): string {
  return `${getPrimaryModifierLabel(navigatorLike)}+${keys}`;
}

export function formatAriaShortcut(keys: string, navigatorLike?: Pick<Navigator, 'platform' | 'userAgent'> | null): string {
  const modifier = getPrimaryModifierLabel(navigatorLike) === 'Cmd' ? 'Meta' : 'Control';
  return `${modifier}+${keys}`;
}
