import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSubnav from './SettingsSubnav.svelte';

afterEach(() => cleanup());

describe('SettingsSubnav', () => {
  it('marks the selected destination and changes panels', async () => {
    const onSelect = vi.fn();
    render(SettingsSubnav, { selected: 'general', onSelect });

    expect(screen.getByRole('button', { name: /General/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Profiles/ })).not.toHaveAttribute('aria-current');

    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    expect(onSelect).toHaveBeenCalledWith('providers');
  });
});
