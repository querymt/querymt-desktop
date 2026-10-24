<script lang="ts">
  import CopyTextChip from '$lib/components/primitives/CopyTextChip.svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import { validateMessageFrontMatter, type MessageFrontMatter } from '$lib/domain/message-frontmatter';

  let { frontMatter, id }: { frontMatter: MessageFrontMatter; id: string } = $props();
  const validationError = $derived(validateMessageFrontMatter(frontMatter.yaml));
</script>

<section {id} class="session-message-metadata markdown-body" aria-label="Message metadata">
  {#if validationError}
    <p class="metadata-validation">YAML validation: {validationError}</p>
  {/if}
  <div class="code-block-shell" use:enhanceCodeBlocks>
    <div class="code-block-header">
      <span class="code-block-language">Message metadata - YAML</span>
      <CopyTextChip value={frontMatter.source} display="Copy" title="Copy metadata" class="code-block-copy" />
    </div>
    <pre><code class="language-yaml">{frontMatter.source}</code></pre>
  </div>
</section>

<style>
  .session-message-metadata {
    width: min(44rem, 86%);
    min-width: 0;
    color: var(--muted);
    font-size: 0.75rem;
  }

  .metadata-validation {
    margin: 0.4rem 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .session-message-metadata :global(pre) {
    max-height: 24rem;
    overflow: auto;
    margin: 0;
    padding: 0.8rem;
    font-family: var(--font-mono);
    white-space: pre;
    tab-size: 2;
  }
</style>
