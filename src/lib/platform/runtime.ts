import { browser } from '$app/environment';

export type AppTarget = 'desktop' | 'embedded';

export const appTarget: AppTarget = import.meta.env.MODE === 'embedded' ? 'embedded' : 'desktop';
export const isEmbedded = appTarget === 'embedded';
export const isDesktop = appTarget === 'desktop';

export const platformCapabilities = Object.freeze({
  managesAgents: isDesktop,
  nativeAgentLogs: isDesktop,
  nativeProfileTemplates: isDesktop,
  nativeWorkspacePicker: isDesktop,
  workspacePathSuggestions: isDesktop,
  windowControls: isDesktop
});

export function isTauriRuntime(): boolean {
  return browser && '__TAURI_INTERNALS__' in window;
}
