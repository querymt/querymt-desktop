import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk';
import type { ComposerOption, ModelEntry } from '$lib/domain/types';

export const CONFIG_MODEL = 'model' as const;
export const CONFIG_PROFILE = 'profile' as const;
export const CONFIG_MODE = 'mode' as const;
export const CONFIG_THOUGHT_LEVEL = 'thought_level' as const;

const REASONING_ALIASES = new Set([CONFIG_THOUGHT_LEVEL, 'reasoning', 'reasoning_effort', 'thought', 'thought_level']);

function normalize(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, '_') ?? '';
}

function isSelectOption(option: SessionConfigOption): option is SessionConfigOption & { type: 'select' } {
  return option.type === 'select';
}

function isSelectGroup(entry: SessionConfigSelectOption | SessionConfigSelectGroup): entry is SessionConfigSelectGroup {
  return 'group' in entry;
}

function findSelectConfigOption(
  options: SessionConfigOption[] | undefined | null,
  targets: string | string[]
): (SessionConfigOption & { type: 'select' }) | undefined {
  const normalizedTargets = new Set((Array.isArray(targets) ? targets : [targets]).map(normalize));
  return options?.find((option) => {
    if (!isSelectOption(option)) return false;
    const id = normalize(option.id);
    const category = normalize(option.category);
    const name = normalize(option.name);
    return normalizedTargets.has(id) || normalizedTargets.has(category) || normalizedTargets.has(name);
  }) as (SessionConfigOption & { type: 'select' }) | undefined;
}

function flattenSelectOptions(option: SessionConfigOption & { type: 'select' }): SessionConfigSelectOption[] {
  return option.options.flatMap((entry) => (isSelectGroup(entry) ? entry.options : [entry]));
}

export function getSelectConfigOptions(options: SessionConfigOption[] | undefined | null): Array<SessionConfigOption & { type: 'select' }> {
  return (options ?? []).filter(isSelectOption);
}

export function findModelConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return findSelectConfigOption(options, CONFIG_MODEL);
}

export function getCurrentModelId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findModelConfigOption(options)?.currentValue;
}

export function findProfileConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return findSelectConfigOption(options, CONFIG_PROFILE);
}

export function getCurrentProfileId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findProfileConfigOption(options)?.currentValue;
}

export function findModeConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return findSelectConfigOption(options, CONFIG_MODE);
}

export function findReasoningConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return findSelectConfigOption(options, Array.from(REASONING_ALIASES));
}

export function getCurrentModeId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findModeConfigOption(options)?.currentValue;
}

export function getCurrentReasoningId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findReasoningConfigOption(options)?.currentValue;
}

export function getProfileChoices(options: SessionConfigOption[] | undefined | null): ComposerOption[] {
  const profileOption = findProfileConfigOption(options);
  if (!profileOption) return [];

  return flattenSelectOptions(profileOption).map((option) => ({
    id: option.value,
    label: option.name,
    description: option.description ?? null
  }));
}

export function getModelChoices(options: SessionConfigOption[] | undefined | null): SessionConfigSelectOption[] {
  const modelOption = findModelConfigOption(options);
  if (!modelOption) return [];

  return flattenSelectOptions(modelOption);
}

export function getConfigOptionChoices(
  option: (SessionConfigOption & { type: 'select' }) | undefined | null
): SessionConfigSelectOption[] {
  return option ? flattenSelectOptions(option) : [];
}

export function setSessionConfigOptionRequest(
  sessionId: string,
  configId: string,
  value: string,
  meta: Record<string, unknown> | null = null
): SetSessionConfigOptionRequest {
  return {
    sessionId,
    configId,
    value,
    _meta: meta ?? undefined
  } as SetSessionConfigOptionRequest;
}

export function setModelConfigOptionRequest(
  sessionId: string,
  model: ModelEntry,
  configId: string = CONFIG_MODEL
): SetSessionConfigOptionRequest {
  return setSessionConfigOptionRequest(sessionId, configId, model.id, {
    querymt: {
      modelEntry: model
    }
  });
}
