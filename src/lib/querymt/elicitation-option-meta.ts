import type { Stream } from '@agentclientprotocol/sdk';
import type { AnyMessage } from '@agentclientprotocol/sdk/dist/jsonrpc.js';

export const QUERYMT_OPTION_DESCRIPTIONS_KEY = 'optionDescriptions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionDescription(option: Record<string, unknown>): string | undefined {
  const title = typeof option.title === 'string' ? option.title : typeof option.const === 'string' ? option.const : '';
  const candidates = [option.description];
  if (isRecord(option._meta) && isRecord(option._meta.querymt)) {
    candidates.push(option._meta.querymt.description);
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const description = candidate.trim();
    if (description && description !== title) return description;
  }

  return undefined;
}

function collectPropertyOptionDescriptions(property: unknown): Record<string, string> | undefined {
  if (!isRecord(property)) return undefined;
  const collections: unknown[] = [property.oneOf];
  if (isRecord(property.items)) {
    collections.push(property.items.anyOf, property.items.oneOf);
  }

  const descriptions: Record<string, string> = {};
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const option of collection) {
      if (!isRecord(option) || typeof option.const !== 'string') continue;
      const description = readOptionDescription(option);
      if (description) descriptions[option.const] = description;
    }
  }

  return Object.keys(descriptions).length > 0 ? descriptions : undefined;
}

export function hoistElicitationOptionDescriptions(message: AnyMessage): AnyMessage {
  if (!('method' in message) || message.method !== 'elicitation/create') return message;
  if (!('params' in message) || !isRecord(message.params)) return message;

  const params = message.params;
  if (params.mode !== 'form' || !isRecord(params.requestedSchema) || !isRecord(params.requestedSchema.properties)) {
    return message;
  }

  const optionDescriptions: Record<string, Record<string, string>> = {};
  for (const [key, property] of Object.entries(params.requestedSchema.properties)) {
    const descriptions = collectPropertyOptionDescriptions(property);
    if (descriptions) optionDescriptions[key] = descriptions;
  }
  if (Object.keys(optionDescriptions).length === 0) return message;

  const existingMeta = isRecord(params._meta) ? params._meta : {};
  const existingQuerymt = isRecord(existingMeta.querymt) ? existingMeta.querymt : {};
  if (isRecord(existingQuerymt[QUERYMT_OPTION_DESCRIPTIONS_KEY])) return message;

  return {
    ...message,
    params: {
      ...params,
      _meta: {
        ...existingMeta,
        querymt: {
          ...existingQuerymt,
          [QUERYMT_OPTION_DESCRIPTIONS_KEY]: optionDescriptions
        }
      }
    }
  };
}

export function preserveElicitationOptionDescriptionsOnStream(stream: Stream): Stream {
  return {
    readable: stream.readable.pipeThrough(
      new TransformStream<AnyMessage, AnyMessage>({
        transform(message, controller) {
          controller.enqueue(hoistElicitationOptionDescriptions(message));
        }
      })
    ),
    writable: stream.writable
  };
}

export function optionDescriptionsFromMeta(meta: unknown): Record<string, Record<string, string>> {
  if (!isRecord(meta) || !isRecord(meta.querymt) || !isRecord(meta.querymt[QUERYMT_OPTION_DESCRIPTIONS_KEY])) {
    return {};
  }

  const raw = meta.querymt[QUERYMT_OPTION_DESCRIPTIONS_KEY];
  const result: Record<string, Record<string, string>> = {};
  for (const [fieldKey, descriptions] of Object.entries(raw)) {
    if (!isRecord(descriptions)) continue;
    const mapped: Record<string, string> = {};
    for (const [value, description] of Object.entries(descriptions)) {
      if (typeof description === 'string' && description.trim()) mapped[value] = description.trim();
    }
    if (Object.keys(mapped).length > 0) result[fieldKey] = mapped;
  }
  return result;
}
