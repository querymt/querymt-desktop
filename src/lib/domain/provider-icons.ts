import type { ModelEntry } from '$lib/domain/types';

const ICON_PREFIX = 'querymt-provider-';
const SPRITE_HOST_ID = 'querymt-provider-sprite';

/** Runtime provider ids mapped to symbol ids in the website provider sprite. */
const PROVIDER_ICON_IDS: Record<string, string> = {
  alibaba: 'alibaba',
  anthropic: 'anthropic',
  codex: 'codex',
  deepseek: 'deepseek',
  google: 'google',
  groq: 'groq',
  izwi: 'izwi',
  'kimi-code': 'kimi',
  kimi: 'kimi',
  'llama-cpp': 'llama-cpp',
  'llama.cpp': 'llama-cpp',
  mistral: 'mistral',
  moonshot: 'moonshot',
  mrs: 'mistral-rs',
  'mistral-rs': 'mistral-rs',
  'mistral.rs': 'mistral-rs',
  ollama: 'ollama',
  openai: 'openai',
  openrouter: 'openrouter',
  xai: 'xai',
  zai: 'zai',
  'z.ai': 'zai',
  'vllm-cpp': 'vllm-cpp',
  'vllm.cpp': 'vllm-cpp'
};

export function providerIconId(provider: string | null | undefined): string | null {
  const key = provider?.trim().toLowerCase();
  if (!key) return null;
  return PROVIDER_ICON_IDS[key] ?? null;
}

export function providerIconHref(iconId: string): string {
  return `#${ICON_PREFIX}${iconId}`;
}

export function modelSelectionTooltip(
  model: Pick<ModelEntry, 'label' | 'model' | 'provider' | 'node_label'>,
  agentLabel?: string | null
): string {
  const name = model.label?.trim() || model.model;
  const node = model.node_label?.trim();
  const where = node ? `${name} from ${model.provider} on ${node}` : `${name} from ${model.provider}`;
  return agentLabel ? `${where} · ${agentLabel}` : where;
}

/** Inject the sprite once so `<use href="#...">` stays same-document in the Tauri webview. */
export function ensureProviderSprite(raw: string): void {
  if (typeof document === 'undefined' || document.getElementById(SPRITE_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = SPRITE_HOST_ID;
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = raw.replaceAll('<symbol id="', `<symbol id="${ICON_PREFIX}`);
  document.body.appendChild(host);
}
