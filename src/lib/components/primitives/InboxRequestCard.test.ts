import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '$lib/domain/types';
import InboxRequestCard from './InboxRequestCard.svelte';

const item: InboxItem = {
  id: 'elicitation-1',
  title: 'Environments',
  detail: 'Choose environments',
  owner: 'session-1',
  severity: 'medium',
  type: 'elicitation',
  sessionId: 'session-1',
  status: 'pending',
  actions: [
    { id: 'accept', label: 'Submit', kind: 'accept' },
    { id: 'cancel', label: 'Cancel', kind: 'cancel' }
  ],
  formFields: [
    {
      key: 'selection',
      label: 'Environments',
      kind: 'array',
      required: true,
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' }
      ],
      value: []
    }
  ]
};

afterEach(cleanup);

describe('InboxRequestCard', () => {
  it('renders multi-select fields and forwards field and action changes', async () => {
    const onFieldChange = vi.fn();
    const onAction = vi.fn();
    render(InboxRequestCard, { item, onFieldChange, onAction });

    await fireEvent.click(screen.getByText('Staging'));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onFieldChange).toHaveBeenCalledWith('elicitation-1', 'selection', ['staging']);
    expect(onAction).toHaveBeenCalledWith('elicitation-1', 'accept');
  });

  it('selects Other, reveals custom input, and forwards the latest typed response', async () => {
    const customItem: InboxItem = {
      ...item,
      formFields: [
        {
          ...item.formFields![0],
          allowCustom: true,
          customActive: false,
          customValue: ''
        }
      ]
    };
    const onCustomFieldToggle = vi.fn();
    const onCustomFieldChange = vi.fn();
    const { rerender } = render(InboxRequestCard, {
      item: customItem,
      onCustomFieldToggle,
      onCustomFieldChange
    });

    await fireEvent.click(screen.getByText('Other…'));
    expect(onCustomFieldToggle).toHaveBeenCalledWith('elicitation-1', 'selection', true);

    customItem.formFields![0] = {
      ...customItem.formFields![0],
      value: [],
      customActive: true
    };
    await rerender({ item: customItem, onCustomFieldToggle, onCustomFieldChange });
    const input = screen.getByRole('textbox', { name: 'Environments custom response' });
    await fireEvent.input(input, { target: { value: 'My custom environment' } });

    expect(onCustomFieldChange).toHaveBeenCalledWith(
      'elicitation-1',
      'selection',
      'My custom environment'
    );
  });
});
