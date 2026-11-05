import { cleanup, render } from '@testing-library/svelte';
import { bench, describe } from 'vitest';
import ModelPickerPanel from '$lib/components/primitives/ModelPickerPanel.svelte';
import type { ModelEntry } from '$lib/domain/types';

const providers = Array.from({ length: 10 }, (_, index) => `provider-${index}`);
const models: ModelEntry[] = providers.flatMap((provider) =>
  Array.from({ length: 40 }, (_, index) => ({
    id: `${provider}/model-${index}`,
    provider,
    model: `model-${index}`,
    label: `Model ${index}`
  }))
);

describe('model picker 400', () => {
  bench(
    'ModelPickerPanel mount and destroy',
    () => {
      render(ModelPickerPanel, { models, onSelect: () => {} });
      cleanup();
    },
    { iterations: 5, warmupIterations: 1 }
  );
});
