import { mount, unmount } from 'svelte';
import { resolveSessionLink, type SessionLinkIndex } from '$lib/domain/sessions';
import SessionReference from './SessionReference.svelte';

interface SessionLinkOptions {
  index: SessionLinkIndex;
  agentId: string | null;
  html: string;
  discoverySource?: string | null;
  discover?: (agentId: string | null, sessionIds: string[]) => (() => void);
}

const UUID_PATTERN = /(?<![\w-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w-])/gi;

/** Enhance only an {@html} subtree, never Svelte-managed streaming text. */
export function enhanceSessionLinks(node: HTMLElement, options: SessionLinkOptions) {
  const document = node.ownerDocument;
  const references = new Map<HTMLElement, { component: ReturnType<typeof mount>; text: string }>();
  const candidates = new Set<string>();
  let stopDiscovery: (() => void) | undefined;

  function watchMissingReferences() {
    stopDiscovery?.();
    const missing = [...candidates].filter((id) => !options.index.has(id));
    stopDiscovery = options.discoverySource && missing.length ? options.discover?.(options.agentId, missing) : undefined;
  }

  function clearReferences() {
    for (const [element, { component, text }] of references) {
      void unmount(component);
      if (node.contains(element)) element.replaceWith(document.createTextNode(text));
    }
    references.clear();
  }

  function refresh() {
    clearReferences();
    candidates.clear();

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(text) {
        return text.parentElement?.closest('a, pre, button, script, style, textarea, svg, .code-block-shell')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);

    for (const text of texts) {
      const source = text.data;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of source.matchAll(UUID_PATTERN)) {
        candidates.add(match[0].toLowerCase());
        const target = resolveSessionLink(options.index, match[0], options.agentId);
        if (!target) continue;
        fragment.append(document.createTextNode(source.slice(offset, match.index)));
        const element = document.createElement('span');
        const component = mount(SessionReference, { target: element, props: { target, text: match[0] } });
        fragment.append(element);
        references.set(element, { component, text: match[0] });
        offset = match.index + match[0].length;
      }
      if (offset) {
        fragment.append(document.createTextNode(source.slice(offset)));
        text.replaceWith(fragment);
      }
    }
  }

  refresh();
  watchMissingReferences();
  return {
    update(next: SessionLinkOptions) {
      const contentChanged = next.agentId !== options.agentId || next.html !== options.html;
      const discoveryChanged = contentChanged || next.discoverySource !== options.discoverySource || next.discover !== options.discover;
      // A page of unrelated sessions must not remount every tooltip in the chat.
      const targetsChanged = next.index !== options.index && [...candidates].some((id) =>
        JSON.stringify(resolveSessionLink(next.index, id, next.agentId)) !== JSON.stringify(resolveSessionLink(options.index, id, options.agentId)));
      options = next;
      if (contentChanged || targetsChanged) refresh();
      if (discoveryChanged) watchMissingReferences();
    },
    destroy() {
      stopDiscovery?.();
      clearReferences();
    }
  };
}
