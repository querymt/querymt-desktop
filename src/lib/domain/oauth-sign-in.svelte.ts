import { agentsStore } from '$lib/stores/agents.svelte';
import { OAuthFlowKind } from '$lib/querymt/querymt-extensions';
import { OAuthStatus } from '$lib/querymt/generated/types';
import { openExternalUrl } from '$native';

const POLL_ATTEMPTS = 60;
const POLL_DELAY_MS = 2000;

/**
 * One OAuth sign-in driven from outside the settings page (the session banner).
 * Starts the agent's `_querymt/auth/start` flow, polls auth status until the
 * login is connected, and falls back to pasting the callback URL or code.
 * Cancelling is UI-side only: the agent has no cancel endpoint.
 */
export class OAuthSignInFlow {
  open = $state(false);
  label = $state('');
  flowKind = $state<OAuthFlowKind | null>(null);
  authorizationUrl = $state('');
  urlCopied = $state(false);
  needsCallbackInput = $state(false);
  value = $state('');
  /** Waiting for the browser login to be detected. */
  waiting = $state(false);
  completing = $state(false);
  /** Set when a sign-in failed; the dialog is closed then. */
  error = $state<string | null>(null);

  private agentId = '';
  private flowId = '';
  private generation = 0;
  private wake: (() => void) | null = null;

  constructor(private readonly onConnected: (id: string) => void = () => {}) {}

  get submitDisabled(): boolean {
    if (this.completing) return true;
    return this.flowKind !== OAuthFlowKind.DevicePoll && !this.value.trim();
  }

  async start(agentId: string, id: string, label: string): Promise<void> {
    const generation = this.reset();
    this.agentId = agentId;
    this.label = label;
    this.open = true;
    this.waiting = true;
    try {
      const start = await agentsStore.startProviderSignIn(agentId, id);
      if (generation !== this.generation) return;
      this.flowId = start.flow_id;
      this.flowKind = start.flow_kind ?? null;
      this.authorizationUrl = start.authorization_url ?? '';
      this.needsCallbackInput = this.flowKind !== OAuthFlowKind.DevicePoll;
      if (!(this.authorizationUrl && this.flowKind === OAuthFlowKind.RedirectCode)) {
        this.waiting = false;
        return;
      }
      const result = await this.poll(generation, start.provider || id);
      if (result === 'connected') this.finish(id);
      else if (result === 'timeout') {
        // Automatic detection did not finish; the pasted callback is the way forward.
        this.waiting = false;
        this.needsCallbackInput = true;
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error, `Failed to start sign-in for ${label}.`);
    }
  }

  async submit(): Promise<void> {
    if (!this.flowId || this.submitDisabled) return;
    const generation = this.generation;
    const id = this.label;
    const response = this.flowKind === OAuthFlowKind.DevicePoll ? '' : this.value.trim();
    // Stop polling: the manual completion takes over.
    this.wake?.();
    this.completing = true;
    try {
      const result = await agentsStore.completeProviderSignIn(this.agentId, this.flowId, response);
      if (generation !== this.generation) return;
      if (result.success) this.finish(result.provider ?? id);
      else this.fail(null, result.message || `Failed to complete sign-in for ${this.label}.`);
    } catch (error) {
      if (generation === this.generation) this.fail(error, `Failed to complete sign-in for ${this.label}.`);
    } finally {
      if (generation === this.generation) this.completing = false;
    }
  }

  cancel(): void {
    this.generation += 1;
    this.wake?.();
    this.close();
  }

  async openAuthorizationUrl(): Promise<void> {
    if (this.authorizationUrl) await openExternalUrl(this.authorizationUrl);
  }

  async copyAuthorizationUrl(): Promise<void> {
    if (!this.authorizationUrl) return;
    try {
      await navigator.clipboard.writeText(this.authorizationUrl);
      this.urlCopied = true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to copy authorization URL.';
    }
  }

  private async poll(generation: number, id: string): Promise<'connected' | 'timeout' | 'cancelled'> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (generation !== this.generation || this.completing) return 'cancelled';
      const entries = await agentsStore.refreshAuthProviders(this.agentId);
      if (generation !== this.generation || this.completing) return 'cancelled';
      if (entries.find((entry) => entry.provider === id)?.oauth_status === OAuthStatus.Connected) return 'connected';
      await this.sleep(POLL_DELAY_MS);
    }
    return generation === this.generation ? 'timeout' : 'cancelled';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }

  private finish(id: string): void {
    this.close();
    this.onConnected(id);
  }

  private fail(error: unknown, fallback: string): void {
    this.error = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
    this.close();
  }

  private close(): void {
    this.open = false;
    this.waiting = false;
    this.completing = false;
    this.flowId = '';
    this.flowKind = null;
    this.authorizationUrl = '';
    this.urlCopied = false;
    this.needsCallbackInput = false;
    this.value = '';
  }

  /** Invalidates any running flow and clears state; returns the new generation. */
  private reset(): number {
    this.generation += 1;
    this.wake?.();
    this.close();
    this.error = null;
    return this.generation;
  }
}
