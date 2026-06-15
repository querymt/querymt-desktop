import type {
  Client,
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification
} from '@agentclientprotocol/sdk';
import type { QuerymtExtensionNotification } from '$lib/querymt/querymt-extensions';

export class BrowserClient implements Client {
  private sessionUpdateHandlers: Array<(notification: SessionNotification) => void> = [];
  private permissionRequestHandlers: Array<
    (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  > = [];
  private elicitationHandlers: Array<
    (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>
  > = [];
  private extensionNotificationHandlers: Array<(notification: QuerymtExtensionNotification) => void> = [];

  async sessionUpdate(params: SessionNotification): Promise<void> {
    console.debug('querymt session/update received', {
      sessionId: params.sessionId,
      update: params.update.sessionUpdate
    });
    for (const handler of this.sessionUpdateHandlers) {
      handler(params);
    }
  }

  async extNotification(method: string, params: unknown): Promise<void> {
    for (const handler of this.extensionNotificationHandlers) {
      handler({
        method: method as QuerymtExtensionNotification['method'],
        params
      } as QuerymtExtensionNotification);
    }
  }

  async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const handler = this.permissionRequestHandlers.at(-1);
    if (handler) {
      return handler(params);
    }

    return {
      outcome: {
        outcome: 'cancelled'
      }
    };
  }

  onSessionUpdate(handler: (notification: SessionNotification) => void): void {
    this.sessionUpdateHandlers.push(handler);
  }

  offSessionUpdate(handler: (notification: SessionNotification) => void): void {
    const index = this.sessionUpdateHandlers.indexOf(handler);
    if (index !== -1) {
      this.sessionUpdateHandlers.splice(index, 1);
    }
  }

  async unstable_createElicitation(
    params: CreateElicitationRequest
  ): Promise<CreateElicitationResponse> {
    const handler = this.elicitationHandlers.at(-1);
    if (handler) {
      return handler(params);
    }

    return {
      action: 'cancel'
    };
  }

  onPermissionRequest(
    handler: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  ): void {
    this.permissionRequestHandlers.push(handler);
  }

  offPermissionRequest(
    handler: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  ): void {
    const index = this.permissionRequestHandlers.indexOf(handler);
    if (index !== -1) {
      this.permissionRequestHandlers.splice(index, 1);
    }
  }

  onElicitationRequest(
    handler: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>
  ): void {
    this.elicitationHandlers.push(handler);
  }

  offElicitationRequest(
    handler: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>
  ): void {
    const index = this.elicitationHandlers.indexOf(handler);
    if (index !== -1) {
      this.elicitationHandlers.splice(index, 1);
    }
  }

  onExtensionNotification(handler: (notification: QuerymtExtensionNotification) => void): void {
    this.extensionNotificationHandlers.push(handler);
  }

  offExtensionNotification(handler: (notification: QuerymtExtensionNotification) => void): void {
    const index = this.extensionNotificationHandlers.indexOf(handler);
    if (index !== -1) {
      this.extensionNotificationHandlers.splice(index, 1);
    }
  }
}
