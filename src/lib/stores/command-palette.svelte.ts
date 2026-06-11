import type { CommandPalettePrefill } from '$lib/domain/types';

export type CommandPaletteMode = 'commands' | 'schedule' | 'remote-create' | 'remote-attach';

class CommandPaletteStore {
  open = $state(false);
  mode = $state<CommandPaletteMode>('commands');
  query = $state('');
  prefill = $state<CommandPalettePrefill | null>(null);

  openCommands(prefill: CommandPalettePrefill | null = null) {
    this.open = true;
    this.mode = 'commands';
    this.query = '';
    this.prefill = prefill;
  }

  openSchedule(prefill: CommandPalettePrefill | null = null) {
    this.open = true;
    this.mode = 'schedule';
    this.query = '';
    this.prefill = prefill;
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
