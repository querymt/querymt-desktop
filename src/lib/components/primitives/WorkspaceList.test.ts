import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceList from './WorkspaceList.svelte';

const workspace = {
  id: 'workspace-1',
  name: 'querymt-desktop',
  path: '/projects/querymt-desktop',
  status: 'indexed' as const,
  defaultRuntime: 'QMTCODE'
};

afterEach(cleanup);

describe('WorkspaceList states', () => {
  it('uses the page-owned hierarchy instead of rendering a duplicate heading', () => {
    render(WorkspaceList, { items: [workspace] });

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Workspace folders' })).toBeInTheDocument();
  });

  it('offers the primary setup action when no folders exist', async () => {
    const onAddWorkspace = vi.fn();
    render(WorkspaceList, { items: [], onAddWorkspace });

    expect(screen.getByText('No workspace folders yet')).toBeInTheDocument();
    expect(screen.getByText('Add a folder to use it as context when starting a session.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Pick folder' }));
    expect(onAddWorkspace).toHaveBeenCalledOnce();
  });

  it('shows a stable loading placeholder instead of the empty state', () => {
    render(WorkspaceList, { items: [], loading: true });

    expect(screen.getByLabelText('Adding workspace')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No workspace folders yet')).not.toBeInTheDocument();
  });

  it('provides recovery when adding a folder fails', async () => {
    const onRetry = vi.fn();
    render(WorkspaceList, { items: [], error: 'Folder picker unavailable.', onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('Workspace could not be added');
    expect(screen.getByRole('alert')).toHaveTextContent('Folder picker unavailable.');
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps existing workspaces visible during picker progress', () => {
    render(WorkspaceList, { items: [workspace], loading: true });

    expect(screen.getByText('querymt-desktop')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Opening folder picker…');
  });

  it('confirms non-destructive workspace removal', async () => {
    const onRemoveWorkspace = vi.fn();
    render(WorkspaceList, { items: [workspace], onRemoveWorkspace });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove querymt-desktop from QueryMT' }));
    expect(screen.getByRole('alertdialog', { name: 'Remove querymt-desktop from QueryMT?' })).toHaveTextContent('The folder and everything inside it stay on disk.');

    await fireEvent.click(screen.getByRole('button', { name: 'Remove from QueryMT' }));
    expect(onRemoveWorkspace).toHaveBeenCalledWith(workspace);
  });
});
