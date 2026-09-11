import type { ModelEntry } from './types';

export function scoreFuzzyQuery(fields: Array<string | null | undefined>, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 1;

  const normalizedFields = fields
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (normalizedFields.length === 0) return Number.NEGATIVE_INFINITY;

  let total = 0;
  for (const token of normalizedQuery.split(/\s+/).filter(Boolean)) {
    const tokenScore = scoreToken(normalizedFields, token);
    if (tokenScore === Number.NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;
    total += tokenScore;
  }
  return total;
}

export function scoreModelSearch(
  model: Pick<ModelEntry, 'label' | 'model' | 'provider' | 'node_label'>,
  query: string,
  extra: Array<string | null | undefined> = []
): number {
  return scoreFuzzyQuery(
    [model.label, model.model, model.provider, model.node_label, ...extra],
    query
  );
}

function scoreToken(fields: string[], token: string): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const field of fields) {
    const substring = field.indexOf(token);
    if (substring !== -1) best = Math.max(best, 1000 - substring);

    const words = field.split(/[^a-z0-9]+/g).filter(Boolean);
    if (words.some((word) => word.startsWith(token))) best = Math.max(best, 800);

    if (isOrderedSubsequence(field, token)) {
      best = Math.max(best, 400 - Math.max(field.length - token.length, 0));
    }
  }
  return best;
}

function isOrderedSubsequence(value: string, token: string): boolean {
  let q = 0;
  for (let i = 0; i < value.length && q < token.length; i += 1) {
    if (value[i] === token[q]) q += 1;
  }
  return q === token.length;
}
