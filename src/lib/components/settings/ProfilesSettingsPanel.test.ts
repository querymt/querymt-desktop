import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilesSettingsPanel from './ProfilesSettingsPanel.svelte';

const { listProfileTemplates, enableProfileTemplate, refreshManagedProfiles } = vi.hoisted(() => ({
  listProfileTemplates: vi.fn(),
  enableProfileTemplate: vi.fn(),
  refreshManagedProfiles: vi.fn(async () => undefined)
}));

vi.mock('$lib/querymt/profile-templates', () => ({
  listProfileTemplates,
  enableProfileTemplate
}));

vi.mock('$lib/stores/agents.svelte', () => ({
  agentsStore: { refreshManagedProfiles }
}));

const profile = {
  id: 'research',
  name: 'Research',
  description: 'Read-heavy web and document research with curated MCP hooks.',
  tags: ['research', 'mcp', 'curated'],
  enabled: false,
  userPath: '/home/user/.config/querymt/profiles/research.toml'
};

beforeEach(() => {
  listProfileTemplates.mockResolvedValue([profile]);
  enableProfileTemplate.mockResolvedValue({ ...profile, enabled: true });
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('ProfilesSettingsPanel', () => {
  it('shows compact profile rows and hides technical details by default', async () => {
    render(ProfilesSettingsPanel);

    expect(await screen.findByText('Research')).toBeInTheDocument();
    expect(screen.getByText(profile.description)).toBeInTheDocument();
    expect(screen.queryByText(profile.userPath)).not.toBeInTheDocument();
    expect(screen.queryByText('research, mcp, curated')).not.toBeInTheDocument();

    const detailsButton = screen.getByRole('button', { name: 'Details' });
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(profile.userPath)).toBeInTheDocument();
    expect(screen.getByText('research, mcp, curated')).toBeInTheDocument();

    await fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(profile.userPath)).not.toBeInTheDocument();
  });

  it('enables a profile with row-local success feedback', async () => {
    render(ProfilesSettingsPanel);
    await screen.findByText('Research');

    await fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(enableProfileTemplate).toHaveBeenCalledWith('research'));
    expect(refreshManagedProfiles).toHaveBeenCalled();
    expect(screen.getByText('Research is ready to use.')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(profile.userPath)).not.toBeInTheDocument();
  });

  it('explains technical behavior only on request', async () => {
    render(ProfilesSettingsPanel);
    await screen.findByText('Research');

    expect(screen.queryByText(/Profiles are stored as TOML/)).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /How profiles work/ }));
    expect(screen.getByText(/Profiles are stored as TOML/)).toBeInTheDocument();
  });

  it('offers recovery when profiles fail to load', async () => {
    listProfileTemplates.mockRejectedValueOnce(new Error('Profile service unavailable'));
    render(ProfilesSettingsPanel);

    expect(await screen.findByText('Profiles could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Profile service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a focused empty state', async () => {
    listProfileTemplates.mockResolvedValueOnce([]);
    render(ProfilesSettingsPanel);

    expect(await screen.findByText('No curated profiles available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
