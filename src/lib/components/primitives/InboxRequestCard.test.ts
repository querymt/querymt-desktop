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
        { value: 'prod', label: 'Production environment with a long descriptive option label' }
      ],
      value: []
    }
  ]
};

afterEach(cleanup);

describe('InboxRequestCard', () => {
  it('renders multi-select fields as vertical non-pill checkboxes and forwards changes', async () => {
    const onFieldChange = vi.fn();
    const onAction = vi.fn();
    render(InboxRequestCard, { item, onFieldChange, onAction });

    const staging = screen.getByRole('checkbox', { name: 'Staging' });
    const longOption = screen.getByRole('checkbox', {
      name: 'Production environment with a long descriptive option label'
    });
    expect(staging).toHaveClass('elicitation-option-row');
    expect(staging).not.toHaveClass('app-checkbox-pill');
    expect(longOption).toBeInTheDocument();

    await fireEvent.click(staging);
    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onFieldChange).toHaveBeenCalledWith('elicitation-1', 'selection', ['staging']);
    expect(onAction).toHaveBeenCalledWith('elicitation-1', 'accept');
  });

  it('emphasizes at most one permission action and prefers allow once', () => {
    const permissionItem: InboxItem = {
      ...item,
      type: 'permission',
      actions: [
        { id: 'allow-always', label: 'Allow always', kind: 'allow_always' },
        { id: 'allow-once', label: 'Allow once', kind: 'allow_once' },
        { id: 'reject', label: 'Reject', kind: 'reject_once' }
      ],
      formFields: undefined
    };

    const { container } = render(InboxRequestCard, { item: permissionItem });

    expect(screen.getByRole('button', { name: 'Allow once' })).toHaveClass('action-btn-primary');
    expect(screen.getByRole('button', { name: 'Allow always' })).not.toHaveClass('action-btn-primary');
    expect(screen.getByRole('button', { name: 'Reject' })).not.toHaveClass('action-btn-primary');
    expect(container.querySelectorAll('.action-btn-primary')).toHaveLength(1);
  });

  it('renders single-select fields as radios and supports a custom answer', async () => {
    const singleItem: InboxItem = {
      ...item,
      formFields: [
        {
          key: 'target',
          label: 'Target environment',
          kind: 'string',
          required: true,
          options: [
            { value: 'staging', label: 'Staging' },
            { value: 'prod', label: 'Production environment with a long descriptive option label' }
          ],
          value: '',
          allowCustom: true,
          customActive: false,
          customValue: ''
        }
      ]
    };
    const onFieldChange = vi.fn();
    const onCustomFieldToggle = vi.fn();
    const onCustomFieldChange = vi.fn();
    const { rerender } = render(InboxRequestCard, {
      item: singleItem,
      onFieldChange,
      onCustomFieldToggle,
      onCustomFieldChange
    });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Target environment*' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('radio', { name: 'Staging' }));
    expect(onFieldChange).toHaveBeenCalledWith('elicitation-1', 'target', 'staging');

    await fireEvent.click(screen.getByRole('radio', { name: 'Custom answer…' }));
    expect(onCustomFieldToggle).toHaveBeenCalledWith('elicitation-1', 'target', true);

    singleItem.formFields![0] = {
      ...singleItem.formFields![0],
      value: '',
      customActive: true
    };
    await rerender({ item: singleItem, onFieldChange, onCustomFieldToggle, onCustomFieldChange });
    const input = screen.getByRole('textbox', { name: 'Target environment custom response' });
    expect(input).toHaveAttribute('placeholder', 'Custom answer…');
    await fireEvent.input(input, { target: { value: 'Development' } });
    expect(onCustomFieldChange).toHaveBeenCalledWith('elicitation-1', 'target', 'Development');
  });

  it('shows an offline question as temporarily unavailable rather than cancelled', () => {
    const offlineItem: InboxItem = { ...item, offline: true };

    render(InboxRequestCard, { item: offlineItem });

    expect(screen.getByRole('status')).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.getByRole('status')).toHaveTextContent(/not cancelled/i);
    expect(screen.getByText('Temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('User cancelled')).not.toBeInTheDocument();
  });

  it('keeps the draft visible but disables every control while offline', () => {
    const offlineItem: InboxItem = {
      ...item,
      offline: true,
      formFields: [
        {
          ...item.formFields![0],
          value: ['staging']
        }
      ]
    };
    const onAction = vi.fn();
    const onFieldChange = vi.fn();
    render(InboxRequestCard, { item: offlineItem, onAction, onFieldChange });

    // Draft survives for after recovery.
    expect(screen.getByRole('checkbox', { name: 'Staging' })).toBeChecked();

    expect(screen.getByRole('checkbox', { name: 'Staging' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Production environment with a long descriptive option label' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onAction).not.toHaveBeenCalled();
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('emits no response when interacting with an offline form', () => {
    const offlineItem: InboxItem = { ...item, offline: true };
    const onAction = vi.fn();
    const onFieldChange = vi.fn();
    const onCustomFieldToggle = vi.fn();
    const onCustomFieldChange = vi.fn();
    render(InboxRequestCard, {
      item: offlineItem,
      onAction,
      onFieldChange,
      onCustomFieldToggle,
      onCustomFieldChange
    });

    const staging = screen.getByRole('checkbox', { name: 'Staging' });
    expect(staging).toBeDisabled();
    fireEvent.click(staging);

    expect(onAction).not.toHaveBeenCalled();
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(onCustomFieldToggle).not.toHaveBeenCalled();
    expect(onCustomFieldChange).not.toHaveBeenCalled();
  });

  it('returns to an actionable state once the connection recovers', async () => {
    const onAction = vi.fn();
    const onFieldChange = vi.fn();
    const { rerender } = render(InboxRequestCard, { item: { ...item, offline: true }, onAction, onFieldChange });

    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

    await rerender({ item: { ...item, offline: false }, onAction, onFieldChange });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Temporarily unavailable')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Staging' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onFieldChange).toHaveBeenCalledWith('elicitation-1', 'selection', ['staging']);
    expect(onAction).toHaveBeenCalledWith('elicitation-1', 'accept');
  });

  it('selects a custom multi-choice answer and forwards the latest typed response', async () => {
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

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Custom answer…' }));
    expect(onCustomFieldToggle).toHaveBeenCalledWith('elicitation-1', 'selection', true);

    customItem.formFields![0] = {
      ...customItem.formFields![0],
      value: [],
      customActive: true
    };
    await rerender({ item: customItem, onCustomFieldToggle, onCustomFieldChange });
    const input = screen.getByRole('textbox', { name: 'Environments custom response' });
    expect(input).toHaveAttribute('placeholder', 'Custom answer…');
    await fireEvent.input(input, { target: { value: 'My custom environment' } });

    expect(onCustomFieldChange).toHaveBeenCalledWith(
      'elicitation-1',
      'selection',
      'My custom environment'
    );
  });
});
