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
        { value: 'staging', label: 'Staging', description: 'Shared preview environment.' },
        { value: 'prod', label: 'Production environment with a long descriptive option label' }
      ],
      value: []
    }
  ]
};

afterEach(cleanup);

describe('InboxRequestCard', () => {
  function customAnswerItem(kind: 'string' | 'array'): InboxItem {
    return {
      ...item,
      actions: [
        { id: 'decline', label: 'Decline', kind: 'decline' },
        { id: 'submit-answer', label: 'Submit', kind: 'accept' },
        { id: 'cancel', label: 'Cancel', kind: 'cancel' }
      ],
      formFields: [{
        ...item.formFields![0],
        kind,
        value: kind === 'array' ? [] : '',
        allowCustom: true,
        customActive: true,
        customValue: ''
      }]
    };
  }

  it.each(['string', 'array'] as const)('submits a %s custom answer with Enter using the same action as Submit', async (kind) => {
    const customItem = customAnswerItem(kind);
    const onAction = vi.fn();
    const onCustomFieldChange = vi.fn();
    render(InboxRequestCard, { item: customItem, onAction, onCustomFieldChange });
    const input = screen.getByRole('textbox', { name: 'Environments custom response' });
    const parentKeydown = vi.fn();
    window.addEventListener('keydown', parentKeydown);

    await fireEvent.input(input, { target: { value: 'Use the latest main revision' } });
    const defaultAllowed = await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', cancelable: true });
    window.removeEventListener('keydown', parentKeydown);

    expect(onCustomFieldChange).toHaveBeenCalledWith(item.id, 'selection', 'Use the latest main revision');
    expect(onCustomFieldChange.mock.invocationCallOrder[0]).toBeLessThan(onAction.mock.invocationCallOrder[0]);
    expect(onAction).toHaveBeenCalledExactlyOnceWith(item.id, 'submit-answer');
    expect(defaultAllowed).toBe(false);
    expect(parentKeydown).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAction).toHaveBeenNthCalledWith(2, item.id, 'submit-answer');
  });

  it.each([
    { key: 'Enter', isComposing: true },
    { key: 'Enter', keyCode: 229 },
    { key: 'Enter', repeat: true },
    { key: 'Enter', shiftKey: true },
    { key: 'Enter', ctrlKey: true },
    { key: 'Enter', metaKey: true },
    { key: 'Enter', altKey: true },
    { key: 'Escape' },
    { key: 'a' }
  ])('does not submit custom answers for composing, repeated, modified, or unrelated keys: %j', async (event) => {
    const onAction = vi.fn();
    render(InboxRequestCard, { item: customAnswerItem('string'), onAction });
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'Environments custom response' }), event);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(['string', 'array'] as const)('blocks Enter for an offline %s custom answer and allows it after recovery', async (kind) => {
    const customItem = customAnswerItem(kind);
    const onAction = vi.fn();
    const { rerender } = render(InboxRequestCard, { item: { ...customItem, offline: true }, onAction });
    const input = screen.getByRole('textbox', { name: 'Environments custom response' });
    expect(input).toBeDisabled();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAction).not.toHaveBeenCalled();

    await rerender({ item: { ...customItem, offline: false } });
    expect(input).toBeEnabled();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledExactlyOnceWith(item.id, 'submit-answer');
  });

  it('does not submit when a request has no accept action', async () => {
    const onAction = vi.fn();
    const customItem = customAnswerItem('string');
    render(InboxRequestCard, { item: { ...customItem, actions: customItem.actions!.filter((action) => action.kind !== 'accept') }, onAction });
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'Environments custom response' }), { key: 'Enter' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does not turn Enter in a permission card into implicit authorization', async () => {
    const onAction = vi.fn();
    render(InboxRequestCard, {
      item: { ...customAnswerItem('string'), type: 'permission', actions: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }] },
      onAction
    });
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'Environments custom response' }), { key: 'Enter' });
    expect(onAction).not.toHaveBeenCalled();
  });

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
    expect(screen.getByText('Shared preview environment.')).toBeInTheDocument();
    expect(staging).toHaveAccessibleDescription('Shared preview environment.');

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
            { value: 'staging', label: 'Staging', description: 'Shared preview environment.' },
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
    expect(screen.getByText('Shared preview environment.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Staging' })).toHaveAccessibleDescription(
      'Shared preview environment.'
    );
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

  it('drops owner/session dump and keeps session id on Open session', async () => {
    const onOpenSession = vi.fn();
    render(InboxRequestCard, {
      item: { ...item, agentId: 'agent-1', agentName: 'WS', sessionId: 'session-1' },
      onOpenSession
    });

    expect(screen.queryByText(/Owner:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Severity:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Session:/)).not.toBeInTheDocument();
    expect(screen.queryByText('WS')).not.toBeInTheDocument();
    expect(screen.queryByText('medium')).not.toBeInTheDocument();
    const openSession = screen.getByRole('button', { name: 'Open session' });
    expect(openSession).not.toHaveAttribute('title');
    expect(openSession.querySelector('.lucide-arrow-up-right')).not.toBeNull();
    await fireEvent.pointerEnter(openSession, { pointerType: 'mouse' });
    const tooltip = await screen.findByText('session-1', { selector: '.app-tooltip-content' });
    expect(tooltip).toHaveClass('app-tooltip-content');
    await fireEvent.click(openSession);
    expect(onOpenSession).toHaveBeenCalledOnce();
  });

  it('shows agent and non-default severity chips only when they add information', async () => {
    const { rerender } = render(InboxRequestCard, {
      item: { ...item, agentName: 'WS', severity: 'high' }
    });

    expect(screen.queryByText('WS')).not.toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();

    await rerender({
      item: { ...item, type: 'permission', agentName: 'WS', severity: 'high' },
      showAgentNames: true
    });
    expect(screen.getByText('WS')).toBeInTheDocument();
    expect(screen.queryByText('high')).not.toBeInTheDocument();
  });

  it('shows only the selected disabled option on a submitted elicitation card', async () => {
    render(InboxRequestCard, {
      item: {
        ...item,
        status: 'resolved',
        resolution: 'Submitted',
        actions: [],
        formFields: [
          {
            ...item.formFields![0],
            kind: 'string',
            value: 'Looks good',
            options: [
              { value: 'Looks good', label: 'Looks good', description: 'Arrow is on the right of Open session.' },
              { value: 'Needs a tweak', label: 'Needs a tweak' }
            ]
          }
        ]
      }
    });

    const selected = screen.getByRole('radio', { name: 'Looks good' });
    expect(selected).toBeChecked();
    expect(selected).toBeDisabled();
    expect(screen.getByText('Arrow is on the right of Open session.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Needs a tweak' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Custom answer…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
    expect(screen.queryByText('elicitation')).not.toBeInTheDocument();
    const submitted = screen.getByRole('button', { name: 'Submitted' });
    expect(submitted).not.toHaveAttribute('title');
    await fireEvent.pointerEnter(submitted, { pointerType: 'mouse' });
    const tooltip = await screen.findByText('Submitted', { selector: '.app-tooltip-content' });
    expect(tooltip).toHaveClass('app-tooltip-content');
  });

  it('collapses to the question and Open session button', async () => {
    const onOpenSession = vi.fn();
    render(InboxRequestCard, {
      item: { ...item, agentId: 'agent-1', sessionId: 'session-1' },
      collapsed: true,
      onOpenSession
    });

    expect(screen.getByText('Choose environments')).toHaveClass('inbox-collapsed-detail');
    expect(screen.queryByRole('heading', { name: 'Environments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submitted' })).not.toBeInTheDocument();
    const openSession = screen.getByRole('button', { name: 'Open session' });
    expect(openSession.querySelector('.lucide-arrow-up-right')).not.toBeNull();
    await fireEvent.click(openSession);
    expect(onOpenSession).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Expand request' }));
    expect(screen.getByRole('heading', { name: 'Environments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse request' }));
    expect(screen.queryByRole('heading', { name: 'Environments' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument();
  });

  it('shows the pending marker on expanded unanswered cards', async () => {
    render(InboxRequestCard, { item });

    const pending = screen.getByRole('button', { name: 'Pending' });
    expect(pending).not.toHaveAttribute('title');
    expect(screen.queryByRole('button', { name: 'Submitted' })).not.toBeInTheDocument();
    await fireEvent.pointerEnter(pending, { pointerType: 'mouse' });
    const tooltip = await screen.findByText('Pending', { selector: '.app-tooltip-content' });
    expect(tooltip).toHaveClass('app-tooltip-content');
  });

  it('marks collapsed submitted cards as submitted instead of pending', () => {
    render(InboxRequestCard, {
      item: {
        ...item,
        status: 'resolved',
        resolution: 'Submitted',
        actions: []
      },
      collapsed: true
    });

    expect(screen.getByRole('button', { name: 'Submitted' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pending' })).not.toBeInTheDocument();
  });
});
