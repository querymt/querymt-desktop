import {
  checkForUpdates,
  getUpdatesStatus,
  installUpdate,
  listenUpdateState,
  restartForUpdate,
  setUpdatePreferences,
  type InstallEvent,
  type UpdatePreferencesPatch,
  type UpdateState,
  type UpdatesStatus
} from '$native';
import { isTauriRuntime, platformCapabilities } from '$lib/platform/runtime';

export interface DownloadProgress {
  received: number;
  total: number | null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export class UpdatesStore {
  status = $state<UpdatesStatus | null>(null);
  progress = $state<DownloadProgress | null>(null);
  /** Last failed action (manual check, preference save, install, restart). */
  actionError = $state<string | null>(null);
  checking = $state(false);
  /** Version the user chose "Later" for; the prompt stays hidden for it until the app restarts. */
  dismissedVersion = $state<string | null>(null);
  supported = $state(false);
  initialized = $state(false);

  private unlisten: (() => void) | null = null;

  get state(): UpdateState {
    return this.status?.state ?? { kind: 'idle' };
  }

  /** The non-modal prompt: a pending update the user has not skipped or postponed, or a finished install. */
  get prompt(): UpdateState | null {
    const state = this.state;
    if (state.kind === 'available') {
      return state.skipped || this.dismissedVersion === state.version ? null : state;
    }
    if (state.kind === 'installing') return state;
    if (state.kind === 'installed') {
      return this.dismissedVersion === state.version ? null : state;
    }
    return null;
  }

  async initialize(): Promise<void> {
    if (this.initialized || !platformCapabilities.selfUpdate || !isTauriRuntime()) return;
    this.initialized = true;
    this.supported = true;
    try {
      this.unlisten = await listenUpdateState((state) => this.applyState(state));
      this.status = await getUpdatesStatus();
    } catch (error) {
      this.actionError = errorMessage(error, 'Could not read the update status.');
    }
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.initialized = false;
  }

  private applyState(state: UpdateState): void {
    if (this.status) this.status = { ...this.status, state };
  }

  private async savePreferences(patch: UpdatePreferencesPatch): Promise<void> {
    this.actionError = null;
    try {
      this.status = await setUpdatePreferences(patch);
    } catch (error) {
      this.actionError = errorMessage(error, 'Could not save the update settings.');
    }
  }

  setChannel(channel: 'stable' | 'nightly'): Promise<void> {
    return this.savePreferences({ channel });
  }

  setAutoCheck(autoCheck: boolean): Promise<void> {
    return this.savePreferences({ autoCheck });
  }

  /** Automatic checks stop prompting for this version; "Check now" still shows it. */
  skip(version: string): Promise<void> {
    this.dismissedVersion = version;
    return this.savePreferences({ skippedVersion: version });
  }

  /** Shows the prompt again, e.g. from Settings after "Later". */
  reopen(): void {
    this.dismissedVersion = null;
  }

  /** Hides the prompt until the next launch without touching the saved preferences. */
  later(version: string): void {
    this.dismissedVersion = version;
  }

  async checkNow(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.actionError = null;
    try {
      this.status = await checkForUpdates(true);
    } catch (error) {
      this.actionError = errorMessage(error, 'The update check failed.');
    } finally {
      this.checking = false;
    }
  }

  async install(): Promise<void> {
    this.actionError = null;
    this.progress = { received: 0, total: null };
    const onEvent = (event: InstallEvent) => {
      const current = this.progress ?? { received: 0, total: null };
      if (event.event === 'started') this.progress = { received: 0, total: event.contentLength };
      else if (event.event === 'progress') {
        this.progress = { ...current, received: current.received + event.chunkLength };
      }
    };
    try {
      await installUpdate(onEvent);
    } catch (error) {
      this.actionError = errorMessage(error, 'The update could not be installed.');
    } finally {
      this.progress = null;
    }
  }

  async restart(): Promise<void> {
    this.actionError = null;
    try {
      await restartForUpdate();
    } catch (error) {
      this.actionError = errorMessage(error, 'The app could not restart.');
    }
  }
}

export const updatesStore = new UpdatesStore();
