import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk';
import type { ComposerOption, ModelEntry } from '$lib/domain/types';

export const CONFIG_MODEL = 'model' as const;
export const CONFIG_PROFILE = 'profile' as const;

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
  target: string
): (SessionConfigOption & { type: 'select' }) | undefined {
  return options?.find((option) => {
    if (!isSelectOption(option)) return false;
    const id = normalize(option.id);
    const category = normalize(option.category);
    const name = normalize(option.name);
    return id === target || category === target || name === target;
  }) as (SessionConfigOption & { type: 'select' }) | undefined;
}

export function findModelConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return findSelectConfigOption(options, CONFIG_MODEL);
}

export function getCurrentModelId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findModelConfigOption(options)?.currentValue;
}

function flattenSelectOptions(option: SessionConfigOption & { type: 'select' }): SessionConfigSelectOption[] {
  return option.options.flatMap((entry) => (isSelectGroup(entry) ? entry.options : [entry]));
}

export function findProfileConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return findSelectConfigOption(options, CONFIG_PROFILE);
}

export function getCurrentProfileId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findProfileConfigOption(options)?.currentValue;
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

export function setModelConfigOptionRequest(
  sessionId: string,
  model: ModelEntry
): SetSessionConfigOptionRequest {
  return {
    sessionId,
    configId: CONFIG_MODEL,
    value: model.id,
    _meta: {
      querymt: {
        modelEntry: model
      }
    }
  } as SetSessionConfigOptionRequest;
}
