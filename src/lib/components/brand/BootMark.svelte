<script lang="ts">
  import { BOOT_MARK_CYCLE_MS, BOOT_MARK_LINKS, BOOT_MARK_NODES, BOOT_MARK_ROTATION, BOOT_MARK_VIEWBOX } from '$lib/design/boot-mark';

  let { state = 'idle', size = 160 }: { state?: 'connecting' | 'idle' | 'failed'; size?: number } = $props();

  const connecting = $derived(state === 'connecting');
</script>

<div
  class="boot-mark"
  class:boot-mark-connecting={connecting}
  class:boot-mark-failed={state === 'failed'}
  style={`--boot-cycle: ${BOOT_MARK_CYCLE_MS}ms; width: ${size}px; height: ${size}px;`}
  role={connecting ? 'progressbar' : 'img'}
  aria-label={connecting ? 'Connecting to QueryMT' : 'QueryMT'}
  aria-busy={connecting}
  data-testid="boot-mark"
  data-state={state}
>
  <svg viewBox={BOOT_MARK_VIEWBOX} width="100%" height="100%" aria-hidden="true">
    <g transform={`rotate(${BOOT_MARK_ROTATION})`}>
      <!-- Paint order is z-order: links first, then an opaque base per hexagon
           so links never show through faded or translucent hexagons. -->
      <g>
        {#each BOOT_MARK_LINKS as link (link.id)}
          <line
            class="boot-mark-link"
            x1={link.a.x} y1={link.a.y} x2={link.b.x} y2={link.b.y}
            style={`--delay: ${link.delay}ms; --length: ${link.length}`}
            stroke-dasharray={`${link.length} ${link.length}`}
          />
        {/each}
      </g>
      <g>
        {#each BOOT_MARK_NODES as node, index (index)}
          <g transform={`translate(${node.x} ${node.y})`}>
            <polygon class="boot-mark-base" points={node.points} />
            <polygon
              class={node.isLogo ? 'boot-mark-logo' : 'boot-mark-peer'}
              points={node.points}
              style={`--delay: ${node.delay}ms`}
            />
          </g>
        {/each}
      </g>
    </g>
  </svg>
</div>
