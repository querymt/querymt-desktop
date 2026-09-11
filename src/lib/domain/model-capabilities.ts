import { AudioLines, FileText, Image, Paperclip, Type, Video } from '@lucide/svelte';
import { getModelSelectionKey } from '$lib/querymt/config-options';
import type { ModelEntry, ModelInfo } from './types';

export const modalityIcons = {
  text: Type,
  image: Image,
  pdf: FileText,
  audio: AudioLines,
  video: Video
};

export type ModelInfoMap = Record<string, ModelInfo | null>;

export function knownInputModalities(model: ModelEntry, infoMap: ModelInfoMap = {}): string[] {
  const modalities = infoMap[getModelSelectionKey(model)]?.capabilities?.modalities?.input;
  if (!modalities?.length) return [];
  return [...new Set(modalities.map((modality) => modality.trim().toLowerCase()).filter(Boolean))];
}

export function displayedInputModalities(model: ModelEntry, infoMap: ModelInfoMap = {}): string[] {
  const modalities = knownInputModalities(model, infoMap);
  return modalities.length > 0 ? modalities : ['text'];
}

export function modalityIcon(modality: string) {
  return modalityIcons[modality as keyof typeof modalityIcons] ?? Paperclip;
}

export function modalityLabel(modality: string, known: boolean) {
  return known ? `Supports ${modality} input` : 'Model modalities unknown';
}

export function formatContextSize(tokens: number) {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return tokens.toLocaleString('en-US');
}

export function showFamily(model: ModelEntry) {
  if (!model.family) return false;
  const family = model.family.toLocaleLowerCase();
  return family !== model.model.toLocaleLowerCase() && family !== model.label?.toLocaleLowerCase();
}
