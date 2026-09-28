import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { findModeConfigOption, getConfigOptionChoices } from '$lib/querymt/config-options';

/** Size of the mode tone palette defined in app.css (`--mode-tone-*`). */
export const SESSION_CONTEXT_TONE_COUNT = 8;

/**
 * Resolves a stable palette index for the session's active context meter.
 *
 * Agent-defined mode ids are arbitrary and opaque — there may be one, five, or
 * none, and their values must never be interpreted. The tone therefore comes
 * from the mode's position in the agent-advertised choice list, so every mode
 * of an agent gets its own color while assignments stay stable. Modes beyond
 * the palette cycle it; an unknown current id falls back to a stable hash of
 * that id. Returns null when the session exposes no usable mode information
 * and the caller should keep the default application accent.
 */
export function getSessionContextTone(
  configOptions: SessionConfigOption[] | undefined | null,
  currentModeId: string | null | undefined
): number | null {
  if (!currentModeId) return null;
  const modeOption = findModeConfigOption(configOptions);
  if (!modeOption) return null;

  const index = getConfigOptionChoices(modeOption).findIndex((choice) => choice.value === currentModeId);
  if (index >= 0) return index % SESSION_CONTEXT_TONE_COUNT;
  return hashModeId(currentModeId) % SESSION_CONTEXT_TONE_COUNT;
}

function hashModeId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
