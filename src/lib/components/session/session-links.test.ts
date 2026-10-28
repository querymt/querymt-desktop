import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { buildSessionLinkIndex, type SessionLinkTarget } from '$lib/domain/sessions';
import { enhanceSessionLinks } from './session-links';

const id = '019aa123-4567-789a-bcde-0123456789ab';
const unknown = '019bb123-4567-789a-bcde-0123456789ab';
const target: SessionLinkTarget = { agentId: 'agent-1', sessionId: id, title: 'Related work' };
const cleanups: Array<() => void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await tick();
});

function setup(html: string, targets: SessionLinkTarget[] = [target]) {
  const node = document.createElement('div');
  node.innerHTML = html;
  const options = { index: buildSessionLinkIndex(targets), agentId: 'agent-1', html };
  document.body.append(node);
  const action = enhanceSessionLinks(node, options);
  cleanups.push(() => { action.destroy(); node.remove(); });
  return { node, options, action };
}

describe('enhanceSessionLinks', () => {
  it('links known UUIDs in prose and inline code without changing their text', () => {
    const { node } = setup(`<p>See (${id}), <code>${id.toUpperCase()}</code>, not ${unknown}.</p>`);
    const links = node.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe(`/sessions/agent-1/${id}`);
    expect(links[0]).not.toHaveAttribute('title');
    expect(node.querySelector('code a')?.textContent).toBe(id.toUpperCase());
    expect(node.textContent).toBe(`See (${id}), ${id.toUpperCase()}, not ${unknown}.`);
  });

  it.each([
    { location: 'local' as const, icon: 'monitor', description: 'Open local session: Related work' },
    { location: 'remote' as const, remoteNodeId: 'peer-1', remoteNodeLabel: 'Build host', icon: 'network', description: 'Open remote session on Build host: Related work' },
    { location: 'remote' as const, remoteNodeId: 'peer-1', icon: 'network', description: 'Open remote session on peer-1: Related work' },
    { location: 'remote' as const, icon: 'network', description: 'Open remote session: Related work' },
    { location: undefined, remoteNodeId: 'peer-1', icon: null, description: 'Open session: Related work' },
    { location: 'local' as const, parentSessionId: 'parent', forkOrigin: 'delegation', icon: 'bot', description: 'Open local delegate: Related work' },
    { location: 'remote' as const, parentSessionId: 'parent', forkOrigin: 'delegation', remoteNodeLabel: 'Build host', icon: 'bot', description: 'Open remote delegate on Build host: Related work' },
    { location: undefined, parentSessionId: 'parent', forkOrigin: 'delegation', icon: 'bot', description: 'Open delegate: Related work' },
    { location: 'local' as const, parentSessionId: 'parent', forkOrigin: 'user', icon: 'monitor', description: 'Open local session: Related work' },
    { location: 'local' as const, forkOrigin: 'delegation', icon: 'monitor', description: 'Open local session: Related work' }
  ])('prefixes $location sessions with $icon and explains the location in the tooltip', async ({ icon, description, ...metadata }) => {
    const { node } = setup(`<p>See <code>${id}</code> and ${unknown}.</p>`, [{ ...target, ...metadata }]);
    const link = node.querySelector('a')!;
    if (icon) {
      expect(link.firstElementChild).toHaveClass(`lucide-${icon}`);
      expect(link.firstElementChild).toHaveAttribute('aria-hidden', 'true');
      expect(link.firstElementChild).toHaveAttribute('width', '12');
    } else {
      expect(link.querySelector('svg')).toBeNull();
    }
    expect(link).toHaveAccessibleName(`${id}: ${description}`);
    expect(link.getAttribute('href')).toBe(`/sessions/agent-1/${id}`);
    expect(link.textContent).toBe(id);
    expect(node.textContent).toBe(`See ${id} and ${unknown}.`);
    expect(node.querySelectorAll('a')).toHaveLength(1);
    await tick();
    await fireEvent.pointerEnter(link);
    expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(description);
  });

  it('discovers only unknown UUIDs in eligible text and cancels when the action is destroyed', () => {
    const { node, action, options } = setup(`<p>${id} <code>${unknown.toUpperCase()}</code> ${unknown}</p><pre>${unknown}</pre>`);
    const stop = vi.fn();
    const discover = vi.fn(() => stop);
    const next = { ...options, discoverySource: 'endpoint-1', discover };
    action.update(next);
    expect(discover).toHaveBeenCalledExactlyOnceWith('agent-1', [unknown]);
    action.update({ ...next, index: buildSessionLinkIndex([target, { ...target, sessionId: unknown }]) });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(node.querySelectorAll('a')).toHaveLength(3);
    action.destroy();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('waits for a connected source, restarts demand on source/content changes, and skips excluded nodes', () => {
    const { action, options } = setup(`<p>${unknown}</p>`, []);
    const stop = vi.fn();
    const discover = vi.fn(() => stop);
    action.update({ ...options, discover, discoverySource: null });
    expect(discover).not.toHaveBeenCalled();
    action.update({ ...options, discover, discoverySource: 'endpoint-1' });
    action.update({ ...options, discover, discoverySource: 'endpoint-2' });
    expect(stop).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledTimes(2);
    action.update({ ...options, discover, discoverySource: 'endpoint-2', html: 'replacement' });
    expect(discover).toHaveBeenCalledTimes(3);

    const excluded = setup(`<a href="/original">${unknown}</a><pre>${unknown}</pre><button>${unknown}</button>`, []);
    excluded.action.update({ ...excluded.options, discover, discoverySource: 'endpoint-2' });
    expect(discover).toHaveBeenCalledTimes(3);
  });

  it('preserves mounted links and tooltips when unrelated index records arrive', () => {
    const { node, action, options } = setup(`<p>${id}</p>`);
    const link = node.querySelector('a');
    action.update({ ...options, index: buildSessionLinkIndex([target, { ...target, sessionId: unknown }]) });
    expect(node.querySelector('a')).toBe(link);
  });

  it('does not link partial UUIDs, longer identifiers, or arbitrary UUIDs', () => {
    const html = `<p>${id.slice(0, -1)} ${unknown} a${id} ${id}f prefix-${id} ${id}-suffix _${id} ${id}_</p>`;
    const { node } = setup(html);
    expect(node.innerHTML).toBe(html);
  });

  it('leaves existing links, code fences, and UI controls untouched', () => {
    const html = `<a href="/original">${id}</a><pre><code>${id}</code></pre><button>${id}</button><div class="code-block-shell">${id}</div>`;
    const { node } = setup(html);
    expect(node.innerHTML).toBe(html);
  });

  it('adds and removes links as known session records change', () => {
    const { node, options, action } = setup(`<p>${id}</p>`, []);
    expect(node.querySelector('a')).toBeNull();
    action.update({ ...options, index: buildSessionLinkIndex([target]) });
    expect(node.querySelector('a')?.textContent).toBe(id);
    action.update(options);
    expect(node.innerHTML).toBe(`<p>${id}</p>`);
  });

  it('updates the destination for a new current agent and skips ambiguous references', () => {
    const other = { ...target, agentId: 'agent-2' };
    const { node, options, action } = setup(`<p>${id}</p>`, [target, other]);
    action.update({ ...options, agentId: 'agent-2' });
    expect(node.querySelector('a')?.getAttribute('href')).toBe(`/sessions/agent-2/${id}`);
    action.update({ ...options, agentId: 'agent-3' });
    expect(node.querySelector('a')).toBeNull();
  });

  it('enhances replacement HTML and does not duplicate links on repeated updates', () => {
    const { node, options, action } = setup(`<p>${id}</p>`);
    const first = node.querySelector('a');
    action.update({ ...options });
    expect(node.querySelector('a')).toBe(first);
    const html = `<p>Updated: <code>${id}</code> ${id}</p>`;
    node.innerHTML = html;
    action.update({ ...options, html });
    action.update({ ...options, html, index: buildSessionLinkIndex([target]) });
    expect(node.querySelectorAll('a')).toHaveLength(2);
    expect(node.querySelector('a a')).toBeNull();
  });

  it('cleans up a visible tooltip when references are removed or the action is destroyed', async () => {
    const { node, options, action } = setup(`<p>${id}</p>`);
    await tick();
    await fireEvent.pointerEnter(node.querySelector('a')!);
    expect(await screen.findByRole('tooltip', { hidden: true })).toBeInTheDocument();
    action.update({ ...options, index: buildSessionLinkIndex([]) });
    await tick();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(node.innerHTML).toBe(`<p>${id}</p>`);

    action.update(options);
    await tick();
    await fireEvent.pointerEnter(node.querySelector('a')!);
    expect(await screen.findByRole('tooltip', { hidden: true })).toBeInTheDocument();
    action.destroy();
    await tick();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(node.innerHTML).toBe(`<p>${id}</p>`);
  });

  it('uses safe DOM attributes and never treats titles as HTML', async () => {
    const title = '<img src=x onerror=alert(1)>';
    const { node } = setup(`<p>${id} &lt;script&gt;</p>`, [{ ...target, agentId: 'agent /?#', title }]);
    const link = node.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(`/sessions/agent%20%2F%3F%23/${id}`);
    expect(link).not.toHaveAttribute('title');
    await tick();
    await fireEvent.pointerEnter(link);
    expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(`Open session: ${title}`);
    expect(document.querySelector('img, script')).toBeNull();
  });
});
