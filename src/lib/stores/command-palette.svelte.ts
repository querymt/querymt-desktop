import type { CommandPalettePrefill } from '$lib/domain/types';

export type CommandPaletteMode = 'commands' | 'remote-create' | 'remote-attach';

class CommandPaletteStore {
  open = $state(false);
  mode = $state<CommandPaletteMode>('commands');
  query = $state('');
  prefill = $state<CommandPalettePrefill | null>(null);
  /** The create-automation dialog is its own surface, not a palette mode. */
  scheduleOpen = $state(false);
  schedulePrefill = $state<CommandPalettePrefill | null>(null);

  openCommands(prefill: CommandPalettePrefill | null = null) {
    this.open = true;
    this.mode = 'commands';
    this.query = '';
    this.prefill = prefill;
  }

  openSchedule(prefill: CommandPalettePrefill | null = null) {
    this.close();
    this.scheduleOpen = true;
    this.schedulePrefill = prefill;
  }

  closeSchedule() {
    this.scheduleOpen = false;
    this.schedulePrefill = null;
  }

  openRemoteCreate(prefill: CommandPalettePrefill | null = null) {
    this.open = true;
    this.mode = 'remote-create';
    this.query = '';
    this.prefill = prefill;
  }

  openRemoteAttach(prefill: CommandPalettePrefill | null = null) {
    this.open = true;
    this.mode = 'remote-attach';
    this.query = '';
    this.prefill = prefill;
  }

  setMode(mode: CommandPaletteMode) {
    this.mode = mode;
    this.query = '';
  }

  close() {
    this.open = false;
    this.mode = 'commands';
    this.query = '';
    this.prefill = null;
  }
}

export const commandPaletteStore = new CommandPaletteStore();
