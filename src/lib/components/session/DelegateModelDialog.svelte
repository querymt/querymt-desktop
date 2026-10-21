<script lang="ts">
  import { getContext } from 'svelte';
  import {
    Brain,
    Check,
    CloudOff,
    HardDrive,
    LoaderCircle,
    Network,
    RefreshCw,
    RotateCcw,
    TriangleAlert,
    Waypoints
  } from '@lucide/svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import ModelPickerPanel from '$lib/components/primitives/ModelPickerPanel.svelte';
  import { type ModelInfoMap } from '$lib/domain/model-capabilities';
  import type { ModelEntry } from '$lib/domain/types';
  import {
    DelegateReasoningEffort,
    type DelegateAssignmentInfo,
    type DelegateAssignmentsInfo,
    type DelegateModelOverride,
    type OrphanedDelegateAssignment
  } from '$lib/querymt/generated/types';
  import { getModelSelectionKey } from '$lib/querymt/config-options';
  import Identicon from '$lib/components/primitives/Identicon.svelte';

  type AssignmentTarget =
    | { kind: 'delegate'; assignment: DelegateAssignmentInfo }
    | { kind: 'orphan'; assignment: OrphanedDelegateAssignment };

  let {
    open = $bindable(false),
    assignments = null,
    models = [],
    recentModelsByDelegate = {},
    modelInfo = {},
    inheritedReasoningLabel = null,
    loading = false,
    modelLoading = false,
    pending = {},
    error = null,
    conflict = false,
    onRefresh,
    onRefreshModels,
    onAssign,
    onDismissConflict
  }: {
    open?: boolean;
    assignments?: DelegateAssignmentsInfo | null;
    models?: ModelEntry[];
    recentModelsByDelegate?: Record<string, ModelEntry[]>;
    modelInfo?: ModelInfoMap;
    inheritedReasoningLabel?: string | null;
    loading?: boolean;
    modelLoading?: boolean;
    pending?: Record<string, boolean>;
    error?: string | null;
    conflict?: boolean;
    onRefresh: () => void | Promise<void>;
    onRefreshModels?: (() => void | Promise<void>) | null;
    onAssign: (
      agentId: string,
      model: DelegateModelOverride | null,
      reasoningEffort?: DelegateReasoningEffort | null
    ) => boolean | Promise<boolean>;
    onDismissConflict?: (() => void) | null;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);
  let selectedTarget = $state<AssignmentTarget | null>(null);
  let query = $state('');
  let pickerPanel = $state<{ focusSearch: () => Promise<void> } | null>(null);
  let focusedPickerAgentId = $state<string | null>(null);

  const anyPending = $derived(Object.values(pending).some(Boolean));
  const editable = $derived(assignments?.editable !== false);
  const reasoningSupported = $derived(assignments?.reasoning_effort_supported === true);
  const activeAssignment = $derived.by(() => {
    const target = selectedTarget;
    if (target?.kind !== 'delegate') return null;
    return assignments?.assignments.find((assignment) => assignment.agent_id === target.assignment.agent_id) ?? target.assignment;
  });
  const activeOrphan = $derived.by(() => {
    const target = selectedTarget;
    if (target?.kind !== 'orphan') return null;
    return assignments?.orphaned_overrides.find((assignment) => assignment.agent_id === target.assignment.agent_id) ?? target.assignment;
  });
  const selectedAgentId = $derived(activeAssignment?.agent_id ?? activeOrphan?.agent_id ?? '');
  const selectedOverride = $derived(activeAssignment?.model ?? activeOrphan?.model ?? null);
  const selectedSelectionKey = $derived(overrideSelectionKey(selectedOverride));
  const currentModel = $derived(findModel(selectedOverride));
  const reasoningOptions = [
    { value: 'inherit', label: 'Inherit' },
    { value: DelegateReasoningEffort.Auto, label: 'Auto' },
    { value: DelegateReasoningEffort.Low, label: 'Low' },
    { value: DelegateReasoningEffort.Medium, label: 'Medium' },
    { value: DelegateReasoningEffort.High, label: 'High' },
    { value: DelegateReasoningEffort.Max, label: 'Max' }
  ];
  const description = $derived(
    assignments
      ? reasoningSupported
        ? `Choose the model and reasoning each ${assignments.profile_id} delegate will use the next time it starts.`
        : `Choose which model each ${assignments.profile_id} delegate will use the next time it starts.`
      : 'Choose delegate routes for the next time they start.'
  );
  const dialogTitle = $derived(selectedTarget ? `Route ${selectedTargetLabel()}` : 'Delegate routing');
  const dialogDescription = $derived(
    selectedTarget
      ? activeOrphan
        ? 'This delegate was removed from the profile. Clear its saved route to finish cleanup.'
        : 'The selected route applies the next time this delegate starts. Already-running work is unchanged.'
      : description
  );

  $effect(() => {
    if (!open) {
      selectedTarget = null;
      query = '';
      focusedPickerAgentId = null;
    }
  });

  $effect(() => {
    if (!open || !selectedTarget || activeOrphan || !pickerPanel) {
      if (!open || !selectedTarget || activeOrphan) focusedPickerAgentId = null;
      return;
    }
    const agentId = selectedAgentId;
    if (!agentId || focusedPickerAgentId === agentId) return;
    focusedPickerAgentId = agentId;
    void pickerPanel.focusSearch();
  });

  $effect(() => {
    if (!selectedTarget || !assignments) return;
    const exists = selectedTarget.kind === 'delegate'
      ? assignments.assignments.some((assignment) => assignment.agent_id === selectedTarget?.assignment.agent_id)
      : assignments.orphaned_overrides.some((assignment) => assignment.agent_id === selectedTarget?.assignment.agent_id);
    if (!exists) selectedTarget = null;
  });

  function overrideSelectionKey(model: DelegateModelOverride | null): string {
    return model?.node_id ? getModelSelectionKey({ id: model.model_id, node_id: model.node_id }) : (model?.model_id ?? '');
  }

  function findModel(model: DelegateModelOverride | null): ModelEntry | null {
    if (!model) return null;
    return models.find((entry) => entry.id === model.model_id && (entry.node_id ?? null) === (model.node_id ?? null)) ?? null;
  }

  function modelLabel(model: DelegateModelOverride | null): string {
    if (!model) return 'Profile default';
    const entry = findModel(model);
    return entry?.label ?? entry?.model ?? model.model_id;
  }

  function defaultLabel(assignment: DelegateAssignmentInfo): string {
    if (!assignment.configured_default_model_id) return 'Profile default';
    return findModel({ model_id: assignment.configured_default_model_id })?.label ?? assignment.configured_default_model_id;
  }

  function selectedTargetLabel(): string {
    return activeAssignment?.name ?? activeOrphan?.agent_id ?? 'delegate';
  }

  function reasoningLabel(reasoningEffort: DelegateReasoningEffort | null | undefined): string {
    if (!reasoningEffort) return inheritedReasoningLabel ? `Inherit · ${inheritedReasoningLabel}` : 'Inherit';
    return reasoningOptions.find((option) => option.value === reasoningEffort)?.label ?? reasoningEffort;
  }

  function selectDelegate(assignment: DelegateAssignmentInfo) {
    if (loading || anyPending) return;
    selectedTarget = { kind: 'delegate', assignment };
    query = '';
  }

  function selectOrphan(assignment: OrphanedDelegateAssignment) {
    if (loading || anyPending) return;
    selectedTarget = { kind: 'orphan', assignment };
    query = '';
  }

  async function assignModel(model: ModelEntry) {
    if (!selectedAgentId || !editable || pending[selectedAgentId]) return;
    await onAssign(selectedAgentId, { model_id: model.id, node_id: model.node_id ?? undefined });
  }

  function returnToRoutingList() {
    if (anyPending) return;
    selectedTarget = null;
  }

  async function useProfileDefault() {
    if (!selectedAgentId || !editable || pending[selectedAgentId]) return;
    await onAssign(selectedAgentId, null);
  }

  async function assignReasoning(value: string) {
    if (!selectedAgentId || !editable || pending[selectedAgentId]) return;
    const reasoningEffort = value === 'inherit' ? null : value as DelegateReasoningEffort;
    await onAssign(selectedAgentId, selectedOverride, reasoningEffort);
  }

  async function clearSavedRoute() {
    if (!selectedAgentId || !editable || pending[selectedAgentId]) return;
    const changed = reasoningSupported
      ? await onAssign(selectedAgentId, null, null)
      : await onAssign(selectedAgentId, null);
    if (changed) selectedTarget = null;
  }

  function handlePickerDismiss(event: Event) {
    if (!selectedTarget) return;
    event.preventDefault();
    if (anyPending) return;
    selectedTarget = null;
  }
</script>

<AppDialog
  bind:open
  title={dialogTitle}
  description={dialogDescription}
  size="wide"
  pending={anyPending}
  closeLabel={selectedTarget ? 'Back to delegate routing' : 'Close delegate routing'}
  portalTarget={overlayPortalTarget}
  contentClass={selectedTarget ? 'delegate-model-dialog delegate-model-picker' : 'delegate-model-dialog'}
  bodyClass={selectedTarget ? 'delegate-model-picker-body' : 'delegate-model-dialog-body'}
  onClose={handlePickerDismiss}
  onEscapeKeydown={handlePickerDismiss}
  onInteractOutside={handlePickerDismiss}
>
  {#if selectedTarget}
    {#if activeOrphan}
      <div class="delegate-model-orphan-detail">
        <TriangleAlert size={18} />
        <span><strong>Saved route for removed role</strong><small>{modelLabel(activeOrphan.model)}{reasoningSupported ? ` · ${reasoningLabel(activeOrphan.reasoning_effort)}` : ''}</small></span>
      </div>
    {:else if activeAssignment}
      {#if activeAssignment.model && !currentModel}
        <div class="delegate-model-notice delegate-model-notice-warning">
          <CloudOff size={16} />
          <span><strong>Current override unavailable.</strong> {activeAssignment.model.model_id}{activeAssignment.model.node_id ? ` on ${activeAssignment.model.node_id}` : ''} is preserved until you replace or reset it.</span>
        </div>
      {/if}
    {/if}

    {#if !activeOrphan}
      <ModelPickerPanel
        bind:this={pickerPanel}
        bind:query
        {models}
        recentModels={recentModelsByDelegate[selectedAgentId] ?? []}
        {modelInfo}
        selectedModelId={selectedSelectionKey}
        searchLabel="Search delegate models"
        loading={modelLoading}
        disabled={!editable || !!pending[selectedAgentId]}
        emptyVariant="delegate"
        onSelect={assignModel}
        onRefresh={onRefreshModels}
        refreshDisabled={!editable || modelLoading}
        reasoning={activeAssignment && reasoningSupported ? {
          title: 'Reasoning effort',
          description: 'Inherit the parent session or override this delegate.',
          value: activeAssignment.reasoning_effort ?? 'inherit',
          options: reasoningOptions,
          ariaLabel: 'Delegate reasoning effort',
          disabled: !editable || !!pending[selectedAgentId],
          onChange: assignReasoning
        } : null}
      />
    {/if}
  {:else}
  {#if conflict}
    <div class="delegate-model-notice delegate-model-notice-warning" role="status">
      <TriangleAlert size={16} />
      <span><strong>Assignments changed elsewhere.</strong> The latest setup is shown; review it before choosing again.</span>
      {#if onDismissConflict}
        <button type="button" onclick={onDismissConflict}>Dismiss</button>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="delegate-model-notice delegate-model-notice-error" role="alert">
      <TriangleAlert size={16} />
      <span>{error}</span>
      <button type="button" onclick={onRefresh}>Retry</button>
    </div>
  {/if}

  {#if loading && !assignments}
    <div class="delegate-model-empty">
      <LoaderCircle size={20} class="animate-spin" />
      <strong>Reading delegate routes</strong>
      <span>No session state is changed while this loads.</span>
    </div>
  {:else if assignments}
    <div class="delegate-model-toolbar">
      <div class="delegate-model-persistence">
        {#if assignments.durable}
          <HardDrive size={14} />
          <span>Saved with this session</span>
          {#if assignments.revision !== null}<small>revision {assignments.revision}</small>{/if}
        {:else}
          <CloudOff size={14} />
          <span>Available for this run only</span>
        {/if}
      </div>
      <button class="action-btn" type="button" disabled={loading || anyPending} onclick={onRefresh}>
        <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
        Refresh
      </button>
    </div>

    {#if !assignments.editable}
      <div class="delegate-model-notice delegate-model-notice-neutral">
        <Waypoints size={16} />
        <span>This is a delegated child. Configure routing on its parent session.</span>
      </div>
    {/if}

    {#if assignments.assignments.length > 0}
      <div class="delegate-model-list" aria-label="Delegate routes">
        {#each assignments.assignments as assignment}
          {@const assignedModel = findModel(assignment.model)}
          <button
            class="delegate-model-row"
            class:delegate-model-row-unavailable={assignment.model && !assignedModel}
            type="button"
            disabled={!assignments.editable || loading || anyPending}
            onclick={() => selectDelegate(assignment)}
          >
            <span class="delegate-model-agent-mark" aria-hidden="true">
              <Identicon seed={assignment.agent_id} size={48} />
            </span>
            <span class="delegate-model-row-copy">
              <span class="delegate-model-row-title">
                <strong>{assignment.name}</strong>
                <code>{assignment.agent_id}</code>
              </span>
              <span>{assignment.description || 'Profile delegate'}</span>
            </span>
            <span class="delegate-model-route">
              <span class="delegate-model-route-label">
                {#if pending[assignment.agent_id]}
                  <LoaderCircle size={14} class="animate-spin" /> Updating…
                {:else}
                  <span class="delegate-model-route-name">
                    <span class="delegate-model-route-model">{modelLabel(assignment.model)}</span>
                    {#if assignment.model}
                      <span class="delegate-model-source">Override</span>
                    {/if}
                  </span>
                  {#if reasoningSupported}<small><Brain size={11} />{reasoningLabel(assignment.reasoning_effort)}</small>{/if}
                  {#if assignedModel?.node_label}<small><Network size={11} />{assignedModel.node_label}</small>{/if}
                {/if}
              </span>
            </span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="delegate-model-empty">
        <Waypoints size={20} />
        <strong>No configurable delegates</strong>
        <span>This profile does not expose delegate roles for this session.</span>
      </div>
    {/if}

    {#if assignments.orphaned_overrides.length > 0}
      <section class="delegate-model-orphans" aria-label="Removed delegate assignments">
        <div>
          <strong>Removed delegates</strong>
          <span>These saved routes no longer match the profile. Clear them when they are no longer needed.</span>
        </div>
        {#each assignments.orphaned_overrides as assignment}
          <button
            class="delegate-model-orphan"
            type="button"
            disabled={!assignments.editable || loading || anyPending}
            onclick={() => selectOrphan(assignment)}
          >
            <TriangleAlert size={14} />
            <span><code>{assignment.agent_id}</code><small>{modelLabel(assignment.model)}{reasoningSupported ? ` · ${reasoningLabel(assignment.reasoning_effort)}` : ''}</small></span>
            {#if pending[assignment.agent_id]}<LoaderCircle size={13} class="animate-spin" />{:else}<RotateCcw size={13} />{/if}
          </button>
        {/each}
      </section>
    {/if}
  {:else if !error}
    <div class="delegate-model-empty">
      <Waypoints size={20} />
      <strong>Delegate routing is unavailable</strong>
      <span>This agent does not expose session delegate assignments.</span>
    </div>
  {/if}
  {/if}

  {#snippet footer()}
    {#if selectedTarget}
      {#if activeAssignment}
        <button
          class="delegate-model-default-choice delegate-model-default-footer"
          class:delegate-model-choice-selected={!activeAssignment.model}
          type="button"
          disabled={!editable || !!pending[selectedAgentId]}
          onclick={useProfileDefault}
        >
          <RotateCcw size={14} />
          <span><strong>Use profile default</strong><small>{defaultLabel(activeAssignment)}</small></span>
          {#if !activeAssignment.model}<Check size={14} />{/if}
        </button>
      {/if}
      {#if activeOrphan}
        <button class="action-btn action-btn-danger" type="button" disabled={!editable || !!pending[selectedAgentId]} onclick={clearSavedRoute}>
          {#if pending[selectedAgentId]}<LoaderCircle size={14} class="animate-spin" />{/if}
          Clear saved route
        </button>
      {/if}
      <button class="action-btn" type="button" disabled={!!pending[selectedAgentId]} onclick={returnToRoutingList}>Done</button>
    {:else}
      <button class="action-btn" type="button" disabled={anyPending} onclick={() => (open = false)}>Done</button>
    {/if}
  {/snippet}
</AppDialog>
