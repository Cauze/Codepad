import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { DEFAULTS, meta, setFontSize, settings } from './config.svelte';
import { togglePalette } from './commands';
import { dlg } from './dialog.svelte';
import { closePalette } from './palette.svelte';
import { closeTab, newFile, openPath, pickFiles, saveAll, saveTab, saveTabAs, store } from './tabs.svelte';

/*
 * The macOS menu bar (src-tauri/src/menu.rs) sends the id of the item that was chosen. Each one does
 * the same thing as its keyboard shortcut in keys.ts.
 */

const actions: Record<string, () => void> = {
  settings: () => void openPath(meta.settingsPath),
  quit: () => void getCurrentWindow().close(),
  new: () => { closePalette(); newFile(); },
  open: () => { closePalette(); void pickFiles(); },
  save: () => { if (store.active) void saveTab(store.active); },
  save_as: () => { if (store.active?.writable) void saveTabAs(store.active); },
  save_all: () => void saveAll(),
  close: () => { closePalette(); if (store.active) void closeTab(store.active); },
  palette: togglePalette,
  zoom_in: () => setFontSize(settings.fontSize + 1),
  zoom_out: () => setFontSize(settings.fontSize - 1),
  zoom_reset: () => setFontSize(DEFAULTS.fontSize),
};

/** Menu items other than Quit are ignored while a dialog is up, like the shortcuts are. */
export async function listenToMenu(): Promise<void> {
  await listen<string>('menu', (e) => {
    if (dlg.open && e.payload !== 'quit') return;
    actions[e.payload]?.();
  });
}
