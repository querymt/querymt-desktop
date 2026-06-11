import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk';
import type { ModelEntry } from '$lib/domain/types';

export const CONFIG_MODEL = 'model' as const;

function normalize(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, '_') ?? '';
}

function isSelectOption(option: SessionConfigOption): option is SessionConfigOption & { type: 'select' } {
  return option.type === 'select';
}

function isSelectGroup(entry: SessionConfigSelectOption | SessionConfigSelectGroup): entry is SessionConfigSelectGroup {
  return 'group' in entry;
}

export function findModelConfigOption(
  options: SessionConfigOption[] | undefined | null
): (SessionConfigOption & { type: 'select' }) | undefined {
  return options?.find((option) => {
    if (!isSelectOption(option)) return false;
    const id = normalize(option.id);
    const category = normalize(option.category);
    const name = normalize(option.name);
    return id === CONFIG_MODEL || category === CONFIG_MODEL || name === CONFIG_MODEL;
  }) as (SessionConfigOption & { type: 'select' }) | undefined;
}

export function getCurrentModelId(options: SessionConfigOption[] | undefined | null): string | undefined {
  return findModelConfigOption(options)?.currentValue;
}

export function getModelChoices(options: SessionConfigOption[] | undefined | null): SessionConfigSelectOption[] {
  const modelOption = findModelConfigOption(options);
  if (!modelOption) return [];

  return modelOption.options.flatMap((entry) => (isSelectGroup(entry) ? entry.options : [entry]));
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
