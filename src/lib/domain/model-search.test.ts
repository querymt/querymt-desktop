import { describe, expect, it } from 'vitest';
import { scoreModelSearch } from './model-search';

const grok = {
  label: 'Grok 4.6',
  model: 'grok-4.6',
  provider: 'xai',
  node_label: 'Build server'
};

const sol = {
  label: 'GPT-5.6 Sol',
  model: 'gpt-5.6-sol',
  provider: 'codex',
  node_label: null
};

describe('scoreModelSearch', () => {
  it('matches model name, provider, and remote host fuzzily', () => {
    expect(scoreModelSearch(grok, 'grk')).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreModelSearch(grok, 'xai')).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreModelSearch(grok, 'build')).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreModelSearch(grok, 'xai grok')).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreModelSearch(grok, 'grok build')).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreModelSearch(sol, 'sol')).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });

  it('rejects queries that miss every identity field', () => {
    expect(scoreModelSearch(grok, 'nomatchxyz')).toBe(Number.NEGATIVE_INFINITY);
    expect(scoreModelSearch(sol, 'build')).toBe(Number.NEGATIVE_INFINITY);
  });
});
