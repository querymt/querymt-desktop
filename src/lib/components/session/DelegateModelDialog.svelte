<script lang="ts">
  import { getContext } from 'svelte';
  import {
    Check,
    CloudOff,
    HardDrive,
    LoaderCircle,
    Network,
    RefreshCw,
    RotateCcw,
    Search,
    TriangleAlert,
    Waypoints
  } from '@lucide/svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import type { ModelEntry } from '$lib/domain/types';
  import type {
    DelegateAssignmentInfo,
    DelegateAssignmentsInfo,
    DelegateModelOverride,
    OrphanedDelegateAssignment
  } from '$lib/querymt/generated/types';
  import { getModelSelectionKey } from '$lib/querymt/config-options';

  type AssignmentTarget =
    | { kind: 'delegate'; assignment: DelegateAssignmentInfo }
    | { kind: 'orphan'; assignment: OrphanedDelegateAssignment };

  let {
    open = $bindable(false),
    assignments = null,
    models = [],
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
    loading?: boolean;
    modelLoading?: boolean;
    pending?: Record<string, boolean>;
    error?: string | null;
    conflict?: boolean;
    onRefresh: () => void | Promise<void>;
    onRefreshModels?: (() => void | Promise<void>) | null;
    onAssign: (agentId: string, model: DelegateModelOverride | null) => boolean | Promise<boolean>;
    onDismissConflict?: (() => void) | null;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);
  let selectedTarget = $state<AssignmentTarget | null>(null);
  let query = $state('');

  const anyPending = $derived(Object.values(pending).some(Boolean));
  const editable = $derived(assignments?.editable !== false);
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
  const filteredModels = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) =>
      [model.label, model.model, model.provider, model.node_label]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle))
    );
  });
  const modelGroups = $derived.by(() => {
    const groups = new Map<string, ModelEntry[]>();
    for (const model of filteredModels) {
      const label = model.node_label ? `${model.provider} · ${model.node_label}` : model.provider;
      groups.set(label, [...(groups.get(label) ?? []), model]);
    }
    return Array.from(groups, ([label, items]) => ({ label, items }));
  });
  const description = $derived(
    assignments
      ? `Choose which model each ${assignments.profile_id} delegate will use the next time it starts.`
      : 'Choose which model each delegate will use the next time it starts.'
  );

  $effect(() => {
    if (!open) {
      selectedTarget = null;
      query = '';
    }
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
    const changed = await onAssign(selectedAgentId, { model_id: model.id, node_id: model.node_id ?? undefined });
    if (changed) selectedTarget = null;
  }

  async function useProfileDefault() {
    if (!selectedAgentId || !editable || pending[selectedAgentId]) return;
    const changed = await onAssign(selectedAgentId, null);
    if (changed) selectedTarget = null;
  }
</script>

<AppDialog
  bind:open
  title="Delegate routing"
  {description}
  size="wide"
  pending={anyPending}
  closeLabel="Close delegate routing"
  portalTarget={overlayPortalTarget}
  contentClass="delegate-model-dialog"
  bodyClass="delegate-model-dialog-body"
>
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
            <span class="delegate-model-agent-mark"><Waypoints size={16} /></span>
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
                  {modelLabel(assignment.model)}
                  {#if assignedModel?.node_label}<small><Network size={11} />{assignedModel.node_label}</small>{/if}
                {/if}
              </span>
              <span class={`delegate-model-source delegate-model-source-${assignment.model ? 'override' : 'default'}`}>
                {assignment.model ? 'Override' : 'Profile'}
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
            <span><code>{assignment.agent_id}</code><small>{modelLabel(assignment.model)}</small></span>
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

  {#snippet footer()}
    <button class="action-btn" type="button" disabled={anyPending} onclick={() => (open = false)}>Done</button>
  {/snippet}
</AppDialog>

{#if selectedTarget}
  <AppDialog
    open={true}
    title={`Route ${selectedTargetLabel()}`}
    description={activeOrphan
      ? 'This delegate was removed from the profile. Clear its saved route to finish cleanup.'
      : 'The selected route applies the next time this delegate starts. Already-running work is unchanged.'}
    size="workflow"
    pending={!!pending[selectedAgentId]}
    closeLabel="Close model selection"
    portalTarget={overlayPortalTarget}
    contentClass="delegate-model-picker"
    bodyClass="delegate-model-picker-body"
    onDismiss={() => (selectedTarget = null)}
  >
    {#if activeOrphan}
      <div class="delegate-model-orphan-detail">
        <TriangleAlert size={18} />
        <span><strong>Saved route for removed role</strong><small>{modelLabel(activeOrphan.model)}</small></span>
      </div>
    {:else if activeAssignment}
      <button
        class="delegate-model-default-choice"
        class:delegate-model-choice-selected={!activeAssignment.model}
        type="button"
        disabled={!editable || !!pending[selectedAgentId]}
        onclick={useProfileDefault}
      >
        <span class="delegate-model-choice-icon"><RotateCcw size={16} /></span>
        <span><strong>Use profile default</strong><small>{defaultLabel(activeAssignment)}</small></span>
        {#if !activeAssignment.model}<Check size={16} />{/if}
      </button>

      {#if activeAssignment.model && !currentModel}
        <div class="delegate-model-notice delegate-model-notice-warning">
          <CloudOff size={16} />
          <span><strong>Current override unavailable.</strong> {activeAssignment.model.model_id}{activeAssignment.model.node_id ? ` on ${activeAssignment.model.node_id}` : ''} is preserved until you replace or reset it.</span>
        </div>
      {/if}
    {/if}

    {#if !activeOrphan}
      <div class="app-picker-search-shell delegate-model-search">
        <Search size={15} />
        <input
          class="app-picker-search-input"
          placeholder="Search models, providers, nodes…"
          bind:value={query}
          aria-label="Search delegate models"
        />
        {#if onRefreshModels}
          <button type="button" aria-label="Refresh delegate models" disabled={!editable || modelLoading} onclick={onRefreshModels}>
            <RefreshCw size={14} class={modelLoading ? 'animate-spin' : ''} />
          </button>
        {/if}
      </div>

      <div class="delegate-model-picker-list">
        {#if modelGroups.length === 0}
          <div class="delegate-model-empty delegate-model-empty-compact">
            <strong>{modelLoading ? 'Loading models…' : 'No matching models'}</strong>
            <span>{models.length === 0 ? 'Refresh after the agent finishes discovering providers.' : `Nothing matches “${query}”.`}</span>
          </div>
        {:else}
          {#each modelGroups as group}
            <section class="delegate-model-picker-group">
              <div class="delegate-model-picker-group-title">{group.label}</div>
              {#each group.items as model}
                {@const selectionKey = getModelSelectionKey(model)}
                <button
                  class="delegate-model-choice"
                  class:delegate-model-choice-selected={selectedSelectionKey === selectionKey}
                  type="button"
                  disabled={!editable || !!pending[selectedAgentId]}
                  onclick={() => assignModel(model)}
                >
                  <span><strong>{model.label ?? model.model}</strong><small>{model.id}</small></span>
                  <span class="delegate-model-choice-meta">
                    {#if model.node_label}<small><Network size={11} />{model.node_label}</small>{/if}
                    {#if selectedSelectionKey === selectionKey}<Check size={16} />{/if}
                  </span>
                </button>
              {/each}
            </section>
          {/each}
        {/if}
      </div>
    {/if}

    {#snippet footer()}
      <button class="action-btn" type="button" disabled={!!pending[selectedAgentId]} onclick={() => (selectedTarget = null)}>Cancel</button>
      {#if activeOrphan}
        <button class="action-btn action-btn-danger" type="button" disabled={!editable || !!pending[selectedAgentId]} onclick={useProfileDefault}>
          {#if pending[selectedAgentId]}<LoaderCircle size={14} class="animate-spin" />{/if}
          Clear saved route
        </button>
      {/if}
    {/snippet}
  </AppDialog>
{/if}
