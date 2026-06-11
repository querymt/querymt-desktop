<script lang="ts">
  let {
    label,
    value,
    tone = 'default'
  }: {
    label: string;
    value: string | number;
    tone?: 'default' | 'success' | 'warn' | 'danger';
  } = $props();

  const toneClass: Record<typeof tone, string> = {
    default: 'text-slate-100',
    success: 'text-emerald-300',
    warn: 'text-amber-300',
    danger: 'text-rose-300'
  };
</script>

<div class="panel-strong p-4">
  <div class="muted text-xs uppercase tracking-[0.2em]">{label}</div>
  <div class={`mt-2 text-3xl font-semibold ${toneClass[tone]}`}>{value}</div>
</div>
