import { invoke } from '@tauri-apps/api/core';
import type { AgentConfig, AgentRuntimeStatus, WorkspaceSuggestion } from '$lib/domain/types';

export interface AgentLogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

interface AgentLaunchRequest {
  agentId: string;
  commandLine: string;
}

interface AgentLogsRequest {
  agentId: string;
}

interface AgentSessionDrainRequest {
  agentId: string;
  sessionId?: string | null;
}

interface AgentWriteRequest {
  agentId: string;
  line: string;
}

interface WorkspaceSuggestRequest {
  input: string;
  limit?: number;
}

interface WorkspaceValidateRequest {
  path: string;
}

export async function getAgentStatus(config: AgentConfig): Promise<AgentRuntimeStatus> {
  return invoke<AgentRuntimeStatus>('querymt_agent_status', {
    request: {
      agentId: config.id,
      commandLine: config.commandLine
    } satisfies AgentLaunchRequest
  });
}

export async function startAgent(config: AgentConfig): Promise<AgentRuntimeStatus> {
  return invoke<AgentRuntimeStatus>('querymt_agent_start', {
    request: {
      agentId: config.id,
      commandLine: config.commandLine
    } satisfies AgentLaunchRequest
  });
}

export async function stopAgent(agentId: string): Promise<AgentRuntimeStatus> {
  return invoke<AgentRuntimeStatus>('querymt_agent_stop', {
    request: {
      agentId
    } satisfies AgentLogsRequest
  });
}

export async function restartAgent(config: AgentConfig): Promise<AgentRuntimeStatus> {
  return invoke<AgentRuntimeStatus>('querymt_agent_restart', {
    request: {
      agentId: config.id,
      commandLine: config.commandLine
    } satisfies AgentLaunchRequest
  });
}

export async function getAgentLogs(agentId: string): Promise<AgentLogEntry[]> {
  return invoke<AgentLogEntry[]>('querymt_agent_logs', {
    request: {
      agentId
    } satisfies AgentLogsRequest
  });
}

export async function drainAgentSessionUpdates(
  agentId: string,
  sessionId?: string | null
): Promise<unknown[]> {
  return invoke<unknown[]>('querymt_agent_drain_session_updates', {
    request: {
      agentId,
      sessionId: sessionId ?? null
    } satisfies AgentSessionDrainRequest
  });
}

export async function writeAgentAcpLine(agentId: string, line: string): Promise<void> {
  return invoke<void>('querymt_agent_write_acp_line', {
    request: {
      agentId,
      line
    } satisfies AgentWriteRequest
  });
}

export async function suggestWorkspacePaths(input: string, limit = 12): Promise<WorkspaceSuggestion[]> {
  return invoke<WorkspaceSuggestion[]>('querymt_workspace_suggest_paths', {
    request: {
      input,
      limit
    } satisfies WorkspaceSuggestRequest
  });
}

export async function validateWorkspaceDirectory(path: string): Promise<boolean> {
  return invoke<boolean>('querymt_workspace_validate_directory', {
    request: {
      path
    } satisfies WorkspaceValidateRequest
  });
}
