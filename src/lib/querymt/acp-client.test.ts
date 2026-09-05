import { describe, expect, it, vi } from 'vitest';
import { DesktopAcpClient } from './acp-client';

const beginSessionReplay = vi.fn(() => ({ sessionId: 'session-1', notifications: [] }));
const completeSessionReplay = vi.fn(() => []);
const abortSessionReplay = vi.fn();
vi.mock('./browser-client', () => ({
  BrowserClient: class {
    beginSessionReplay = beginSessionReplay;
    completeSessionReplay = completeSessionReplay;
    abortSessionReplay = abortSessionReplay;
  }
}));

describe('DesktopAcpClient session metadata', () => {
  it('includes the desktop session-load operation id in ACP metadata', async () => {
    const client = new DesktopAcpClient({ id: 'agent-1', name: 'Agent', transport: 'stdio', commandLine: 'agent', enabled: true, autoStart: true });
    const loadSession = vi.fn(async () => ({ configOptions: [] }));
    (client as unknown as { connection: { loadSession: typeof loadSession } }).connection = { loadSession };

    await expect(client.loadSession('session-1', '/tmp/work', 'operation-1')).resolves.toEqual({
      response: { configOptions: [] },
      replay: []
    });
    expect(beginSessionReplay).toHaveBeenCalledWith('session-1');
    expect(completeSessionReplay).toHaveBeenCalledTimes(1);
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cwd: '/tmp/work',
      mcpServers: [],
      _meta: { querymt: { session_load_operation_id: 'operation-1' } }
    });
  });

function promptClient(capabilities: { image?: boolean; embeddedContext?: boolean }) {
  const client = new DesktopAcpClient({ id: 'agent-1', name: 'Agent', transport: 'stdio', commandLine: 'agent', enabled: true, autoStart: true });
  const prompt = vi.fn(async (_request: unknown) => ({ stopReason: 'end_turn' as const }));
  (client as unknown as { connection: { prompt: typeof prompt }; initializeResponse: unknown }).connection = { prompt };
  (client as unknown as { initializeResponse: unknown }).initializeResponse = {
    protocolVersion: 1,
    agentCapabilities: { promptCapabilities: capabilities },
    authMethods: []
  };
  return { client, prompt };
}

const image = { id: 'img-1', name: 'screen shot.png', mimeType: 'image/png', size: 3, data: 'aW1n' };
const file = { id: 'file-1', name: 'notes.txt', mimeType: 'text/plain', size: 4, data: 'dGV4dA==' };
const pdf = { id: 'pdf-1', name: 'report.pdf', mimeType: 'application/pdf', size: 3, data: 'cGRm' };

describe('DesktopAcpClient sendPrompt', () => {
  it('serializes native images, resources, ordering, metadata, and correlation IDs', async () => {
    const { client, prompt } = promptClient({ image: true, embeddedContext: true });
    await client.sendPrompt('session-1', 'Inspect', [image, file], { imageMode: 'image', clientPromptId: 'client-1' });

    expect(prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [
        { type: 'text', text: 'Inspect' },
        { type: 'image', data: 'aW1n', mimeType: 'image/png', _meta: { querymt: { attachment_id: 'img-1', filename: 'screen shot.png', size: 3 } } },
        {
          type: 'resource',
          _meta: { querymt: { attachment_id: 'file-1', filename: 'notes.txt', size: 4 } },
          resource: {
            uri: 'attachment:///file-1/notes.txt', blob: 'dGV4dA==', mimeType: 'text/plain',
            _meta: { querymt: { attachment_id: 'file-1', filename: 'notes.txt', size: 4 } }
          }
        }
      ],
      _meta: { querymt: { client_prompt_id: 'client-1' } }
    });
    expect(JSON.stringify(prompt.mock.calls[0])).not.toContain('file://');
  });

  it('serializes mixed native images, PDFs, and generic resources in input order', async () => {
    const { client, prompt } = promptClient({ image: true, embeddedContext: true });
    await client.sendPrompt('session-1', 'Inspect', [pdf, image, file], { imageMode: 'image' });

    const request = prompt.mock.calls[0]?.[0] as { prompt: Array<Record<string, unknown>> };
    expect(request.prompt.map((block) => block.type)).toEqual(['text', 'resource', 'image', 'resource']);
    expect(request.prompt[1]).toMatchObject({
      type: 'resource',
      resource: { uri: 'attachment:///pdf-1/report.pdf', blob: 'cGRm', mimeType: 'application/pdf' }
    });
    expect(request.prompt[2]).toMatchObject({ type: 'image', data: 'aW1n', mimeType: 'image/png' });
    expect(request.prompt[3]).toMatchObject({
      type: 'resource',
      resource: { uri: 'attachment:///file-1/notes.txt', blob: 'dGV4dA==', mimeType: 'text/plain' }
    });
  });

  it('serializes image mode resources and supports attachment-only prompts', async () => {
    const { client, prompt } = promptClient({ embeddedContext: true });
    await client.sendPrompt('session-1', '', [image], { imageMode: 'resource' });
    const request = prompt.mock.calls[0]?.[0] as { prompt: unknown[] };
    expect(request.prompt).toEqual([
      expect.objectContaining({
        type: 'resource',
        resource: expect.objectContaining({ uri: 'attachment:///img-1/screen%20shot.png', blob: 'aW1n', mimeType: 'image/png' })
      })
    ]);
  });

  it('rejects unsupported native images before sending', async () => {
    const { client, prompt } = promptClient({ embeddedContext: true });
    await expect(client.sendPrompt('session-1', '', [image], { imageMode: 'image' })).rejects.toThrow('does not support native image prompts');
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['false', { embeddedContext: false }]
  ])('rejects resource prompts when embedded context support is %s', async (_label, capabilities) => {
    const { client, prompt } = promptClient(capabilities);
    await expect(client.sendPrompt('session-1', 'Read', [file], { imageMode: 'image' })).rejects.toThrow(
      'does not support embedded resources'
    );
    await expect(client.sendPrompt('session-1', '', [image], { imageMode: 'resource' })).rejects.toThrow(
      'does not support embedded resources'
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { embeddedContext: true }],
    ['false', { image: false, embeddedContext: true }]
  ])('rejects native images when image support is %s', async (_label, capabilities) => {
    const { client, prompt } = promptClient(capabilities);
    await expect(client.sendPrompt('session-1', '', [image], { imageMode: 'image' })).rejects.toThrow(
      'does not support native image prompts'
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it('keeps text-only prompts compatible without advertised optional capabilities', async () => {
    const { client, prompt } = promptClient({});
    await client.sendPrompt('session-1', 'Hello');
    expect(prompt).toHaveBeenCalledWith({ sessionId: 'session-1', prompt: [{ type: 'text', text: 'Hello' }], _meta: undefined });
  });
});

describe('DesktopAcpClient forkSession', () => {
  it('uses native ACP fork with QueryMT historical message metadata', async () => {
    const client = new DesktopAcpClient({ id: 'agent-1', name: 'Agent', transport: 'stdio', commandLine: 'agent', enabled: true, autoStart: true });
    const unstable_forkSession = vi.fn(async () => ({ sessionId: 'fork-1' }));
    (client as unknown as { connection: { unstable_forkSession: typeof unstable_forkSession } }).connection = { unstable_forkSession };

    await expect(client.forkSession('source-1', '/tmp/work', 'assistant-2')).resolves.toEqual({ sessionId: 'fork-1' });
    expect(unstable_forkSession).toHaveBeenCalledWith({
      sessionId: 'source-1',
      cwd: '/tmp/work',
      mcpServers: [],
      _meta: { querymt: { message_id: 'assistant-2' } }
    });
  });
});
