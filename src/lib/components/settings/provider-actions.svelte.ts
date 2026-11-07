import { agentsStore } from '$lib/stores/agents.svelte';
import { isMcpAuthId } from '$lib/domain/mcp-auth';
import { AuthMethod, OAuthStatus, type AuthProviderStatus } from '$lib/querymt/generated/types';
import { OAuthFlowKind } from '$lib/querymt/querymt-extensions';
import { openExternalUrl } from '$native';
import { captureProviderDialogFocusTarget, type ProviderDialogFocusTarget } from './provider-dialog-focus';

type OAuthPollResult = 'connected' | 'timeout' | 'cancelled';

/**
 * Provider and connector auth actions (OAuth sign-in, API keys, disconnect,
 * auth method) with their dialog state. Shared by Settings and the setup wizard.
 */
export class ProviderActionsController {
  actionLoading = $state<string | null>(null);
  pageError = $state<string | null>(null);
  pageMessage = $state<string | null>(null);
  tokenDialogProvider = $state<AuthProviderStatus | null>(null);
  tokenDialogValue = $state('');
  manualOAuthProvider = $state<AuthProviderStatus | null>(null);
  manualOAuthFlowId = $state('');
  manualOAuthFlowKind = $state<OAuthFlowKind | null>(null);
  manualOAuthAuthorizationUrl = $state('');
  manualOAuthUrlCopied = $state(false);
  manualOAuthNeedsCallbackInput = $state(false);
  manualOAuthValue = $state('');
  disconnectProviderPending = $state<AuthProviderStatus | null>(null);
  clearKeyProviderPending = $state<AuthProviderStatus | null>(null);
  providerDialogFocusTarget = $state<ProviderDialogFocusTarget | null>(null);
  providerPendingAction = $state<{ provider: string; action: string } | null>(null);
  providerMessages = $state<Record<string, string | undefined>>({});
  providerErrors = $state<Record<string, string | undefined>>({});

  private oauthCancelRequested = false;
  private oauthCancelResolver: (() => void) | null = null;

  constructor(private readonly getAgentId: () => string) {}

  // Sign-in shares one cancel flag, poll resolver and dialog, so only one flow may run at a time
  // (across providers and MCP servers) until its async work, including a cancelled one, has finished.
  get oauthLocked(): boolean {
    return Boolean(this.actionLoading?.startsWith('oauth')) ||
      this.manualOAuthProvider !== null ||
      Boolean(this.providerPendingAction?.action.startsWith('oauth'));
  }

  get manualOAuthIsDevicePoll(): boolean {
    return this.manualOAuthFlowKind === OAuthFlowKind.DevicePoll;
  }

  clearPageStatus() {
    this.pageError = null;
    this.pageMessage = null;
  }

  private setBusy(value: string | null) {
    this.actionLoading = value;
  }

  private startProviderAction(provider: AuthProviderStatus, action: string) {
    this.providerPendingAction = { provider: provider.provider, action };
    this.providerMessages = { ...this.providerMessages, [provider.provider]: undefined };
    this.providerErrors = { ...this.providerErrors, [provider.provider]: undefined };
  }

  private finishProviderAction(provider: AuthProviderStatus, action: string) {
    if (this.providerPendingAction?.provider === provider.provider && this.providerPendingAction.action === action) {
      this.providerPendingAction = null;
    }
  }

  private setProviderMessage(provider: AuthProviderStatus, message: string) {
    this.providerMessages = { ...this.providerMessages, [provider.provider]: message };
    this.providerErrors = { ...this.providerErrors, [provider.provider]: undefined };
  }

  private setProviderError(provider: AuthProviderStatus, message: string) {
    this.providerErrors = { ...this.providerErrors, [provider.provider]: message };
    this.providerMessages = { ...this.providerMessages, [provider.provider]: undefined };
  }

  isOAuthLoading(provider: AuthProviderStatus) {
    return this.actionLoading === `oauth:${provider.provider}`;
  }

  isOAuthCompleting(provider: AuthProviderStatus) {
    return this.actionLoading === `oauth-complete:${provider.provider}`;
  }

  isManualOAuthSubmitDisabled() {
    if (!this.manualOAuthProvider) return true;
    if (this.isOAuthCompleting(this.manualOAuthProvider)) return true;
    if (this.actionLoading && !this.isOAuthLoading(this.manualOAuthProvider)) return true;
    return !this.manualOAuthIsDevicePoll && !this.manualOAuthValue.trim();
  }

  requestOAuthCancel = (provider: AuthProviderStatus) => {
    if (!this.isOAuthLoading(provider)) return;

    // UI-side cancellation only: QueryMT ACP auth has no cancel endpoint yet.
    // If stale backend flows become a problem, add backend cancel support instead of using logout, which deletes credentials.
    this.oauthCancelRequested = true;
    this.clearPageStatus();
    this.setProviderMessage(provider, `Cancelled sign-in for ${provider.display_name}.`);
    // Stay pending until handleOAuth's async work settles, so a new sign-in cannot overlap it.
    this.providerPendingAction = { provider: provider.provider, action: 'oauth-cancelling' };
    this.closeManualOAuthDialog();
    this.oauthCancelResolver?.();
  };

  private waitForOAuthPoll(delayMs: number) {
    return new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        this.oauthCancelResolver = null;
        resolve();
      }, delayMs);

      this.oauthCancelResolver = () => {
        window.clearTimeout(timeoutId);
        this.oauthCancelResolver = null;
        resolve();
      };
    });
  }

  private async pollProviderSignInUntilCancelled(agentId: string, providerName: string, attempts = 60, delayMs = 2000): Promise<OAuthPollResult> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.oauthCancelRequested) return 'cancelled';

      const providers = await agentsStore.refreshAuthProviders(agentId);
      if (this.oauthCancelRequested) return 'cancelled';

      const match = providers.find((entry) => entry.provider === providerName);
      if (match?.oauth_status === OAuthStatus.Connected) {
        if (!isMcpAuthId(providerName)) await agentsStore.refreshModelsForAgent(agentId).catch(() => undefined);
        return 'connected';
      }

      await this.waitForOAuthPoll(delayMs);
    }

    return this.oauthCancelRequested ? 'cancelled' : 'timeout';
  }

  closeTokenDialog = () => {
    this.tokenDialogProvider = null;
    this.tokenDialogValue = '';
  };

  closeManualOAuthDialog() {
    this.manualOAuthProvider = null;
    this.manualOAuthFlowId = '';
    this.manualOAuthFlowKind = null;
    this.manualOAuthAuthorizationUrl = '';
    this.manualOAuthUrlCopied = false;
    this.manualOAuthNeedsCallbackInput = false;
    this.manualOAuthValue = '';
  }

  private showOAuthDialog(
    provider: AuthProviderStatus,
    flowId: string,
    flowKind: OAuthFlowKind | null | undefined,
    authorizationUrl: string | null | undefined,
    needsCallbackInput = false
  ) {
    this.manualOAuthProvider = provider;
    this.manualOAuthFlowId = flowId;
    this.manualOAuthFlowKind = flowKind ?? null;
    this.manualOAuthAuthorizationUrl = authorizationUrl ?? '';
    this.manualOAuthUrlCopied = false;
    this.manualOAuthNeedsCallbackInput = needsCallbackInput;
    this.manualOAuthValue = '';
  }

  openManualOAuthAuthorizationUrl = async () => {
    if (!this.manualOAuthAuthorizationUrl || !this.manualOAuthProvider) return;
    await openExternalUrl(this.manualOAuthAuthorizationUrl);
    this.pageError = null;
    this.pageMessage = `Opened sign-in for ${this.manualOAuthProvider.display_name}.`;
  };

  copyManualOAuthAuthorizationUrl = async () => {
    if (!this.manualOAuthAuthorizationUrl) return;
    try {
      await navigator.clipboard.writeText(this.manualOAuthAuthorizationUrl);
      this.manualOAuthUrlCopied = true;
      this.pageError = null;
    } catch (error) {
      this.pageError = error instanceof Error ? error.message : 'Failed to copy authorization URL.';
    }
  };

  closeOrCancelManualOAuthDialog = () => {
    if (this.actionLoading?.startsWith('oauth:') && this.manualOAuthProvider) {
      this.requestOAuthCancel(this.manualOAuthProvider);
      return;
    }
    this.closeManualOAuthDialog();
  };

  closeDisconnectDialog = () => {
    this.disconnectProviderPending = null;
  };

  closeClearKeyDialog = () => {
    this.clearKeyProviderPending = null;
  };

  submitManualOAuth = async () => {
    const agentId = this.getAgentId();
    if (!agentId || !this.manualOAuthProvider || !this.manualOAuthFlowId) return;
    if (!this.manualOAuthIsDevicePoll && !this.manualOAuthValue.trim()) return;

    const provider = this.manualOAuthProvider;
    const flowId = this.manualOAuthFlowId;
    const response = this.manualOAuthIsDevicePoll ? '' : this.manualOAuthValue.trim();

    if (this.isOAuthLoading(provider)) {
      this.oauthCancelRequested = true;
      this.oauthCancelResolver?.();
    }

    this.setBusy(`oauth-complete:${provider.provider}`);
    this.startProviderAction(provider, 'oauth-complete');
    this.clearPageStatus();

    try {
      const result = await agentsStore.completeProviderSignIn(agentId, flowId, response);
      if (result.success) {
        const message = result.message || `Successfully authenticated with ${provider.display_name}.`;
        this.pageMessage = message;
        this.setProviderMessage(provider, message);
        this.closeManualOAuthDialog();
      } else {
        const message = result.message || `Failed to complete sign-in for ${provider.display_name}.`;
        this.pageError = message;
        this.setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to complete sign-in for ${provider.display_name}.`;
      this.pageError = message;
      this.setProviderError(provider, message);
    } finally {
      this.setBusy(null);
      this.finishProviderAction(provider, 'oauth-complete');
    }
  };

  private async runResultAction(
    provider: AuthProviderStatus,
    action: string,
    call: () => Promise<{ success?: boolean; message?: string | null }>,
    successText: string,
    failureText: string,
    onSuccess: () => void
  ) {
    this.setBusy(`${action}:${provider.provider}`);
    this.startProviderAction(provider, action);
    this.clearPageStatus();
    try {
      const result = await call();
      if (result.success) {
        const message = result.message || successText;
        this.pageMessage = message;
        this.setProviderMessage(provider, message);
        onSuccess();
      } else {
        const message = result.message || failureText;
        this.pageError = message;
        this.setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : failureText;
      this.pageError = message;
      this.setProviderError(provider, message);
    } finally {
      this.setBusy(null);
      this.finishProviderAction(provider, action);
    }
  }

  submitApiToken = async () => {
    const agentId = this.getAgentId();
    if (!agentId || !this.tokenDialogProvider || !this.tokenDialogValue.trim()) return;
    const provider = this.tokenDialogProvider;
    const value = this.tokenDialogValue.trim();
    await this.runResultAction(
      provider, 'token',
      () => agentsStore.setProviderApiToken(agentId, provider.provider, value),
      `Stored API key for ${provider.display_name}.`,
      `Failed to store API key for ${provider.display_name}.`,
      this.closeTokenDialog
    );
  };

  confirmDisconnectProvider = async () => {
    const agentId = this.getAgentId();
    if (!agentId || !this.disconnectProviderPending) return;
    const provider = this.disconnectProviderPending;
    await this.runResultAction(
      provider, 'disconnect',
      () => agentsStore.disconnectProvider(agentId, provider.provider),
      `Disconnected ${provider.display_name}.`,
      `Failed to disconnect ${provider.display_name}.`,
      this.closeDisconnectDialog
    );
  };

  confirmClearApiToken = async () => {
    const agentId = this.getAgentId();
    if (!agentId || !this.clearKeyProviderPending) return;
    const provider = this.clearKeyProviderPending;
    await this.runResultAction(
      provider, 'clear-token',
      () => agentsStore.clearProviderApiToken(agentId, provider.provider),
      `Cleared API key for ${provider.display_name}.`,
      `Failed to clear API key for ${provider.display_name}.`,
      this.closeClearKeyDialog
    );
  };

  handleAuthMethodChange = async (provider: AuthProviderStatus, value: string) => {
    const agentId = this.getAgentId();
    if (!agentId || value === 'auto') return;
    await this.runResultAction(
      provider, 'method',
      () => agentsStore.setProviderAuthMethod(agentId, provider.provider, value as AuthMethod),
      `Updated auth method for ${provider.display_name}.`,
      `Failed to update auth method for ${provider.display_name}.`,
      () => undefined
    );
  };

  handleOAuth = async (provider: AuthProviderStatus) => {
    const agentId = this.getAgentId();
    if (!agentId || this.oauthLocked) return;
    this.setBusy(`oauth:${provider.provider}`);
    this.startProviderAction(provider, 'oauth');
    this.oauthCancelRequested = false;
    this.clearPageStatus();

    try {
      const start = await agentsStore.startProviderSignIn(agentId, provider.provider);
      const providerName = start.provider || provider.provider;

      const flowKind = start.flow_kind ?? null;
      const waitsForRedirectCallback = Boolean(start.authorization_url && flowKind === OAuthFlowKind.RedirectCode);
      const showsCallbackInput = flowKind !== OAuthFlowKind.DevicePoll;

      this.showOAuthDialog(provider, start.flow_id, flowKind, start.authorization_url, showsCallbackInput);

      if (!waitsForRedirectCallback) return;

      const pollResult = await this.pollProviderSignInUntilCancelled(agentId, providerName);
      if (pollResult === 'connected') {
        const message = `Successfully authenticated with ${providerName}.`;
        this.closeManualOAuthDialog();
        this.pageMessage = message;
        this.setProviderMessage(provider, message);
        return;
      }
      if (pollResult === 'cancelled') return;

      this.pageMessage = `Waiting for ${providerName} sign-in to complete. Paste the callback URL or code below if automatic completion does not finish.`;
      this.manualOAuthNeedsCallbackInput = true;
    } catch (error) {
      if (!this.oauthCancelRequested) {
        const message = error instanceof Error ? error.message : `Failed to start sign-in for ${provider.provider}.`;
        this.pageError = message;
        this.setProviderError(provider, message);
      }
    } finally {
      this.oauthCancelRequested = false;
      this.oauthCancelResolver = null;
      if (this.actionLoading === `oauth:${provider.provider}`) {
        this.setBusy(null);
        this.finishProviderAction(provider, 'oauth');
        this.finishProviderAction(provider, 'oauth-cancelling');
      }
    }
  };

  rememberProviderDialogTrigger = (event: MouseEvent) => {
    this.providerDialogFocusTarget = captureProviderDialogFocusTarget(event);
  };

  handleDisconnect = (provider: AuthProviderStatus) => {
    this.disconnectProviderPending = provider;
  };

  handleSetApiToken = (provider: AuthProviderStatus) => {
    this.tokenDialogProvider = provider;
    this.tokenDialogValue = '';
  };

  handleClearApiToken = (provider: AuthProviderStatus) => {
    this.clearKeyProviderPending = provider;
  };
}
