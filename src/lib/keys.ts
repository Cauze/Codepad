import { getCurrentWindow } from '@tauri-apps/api/window';
import { DEFAULTS, changeSetting, setFontSize, settings } from './config.svelte';
import { dlg } from './dialog.svelte';
import { gotoLine, switchTab, togglePalette } from './commands';
import { closePalette } from './palette.svelte';
import { activate, closeTab, cycle, pickFiles, saveAll, saveTab, store } from './tabs.svelte';

export function handleKeydown(e: KeyboardEvent): void {
  if (dlg.open) return; // the dialog handles its own keys
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'F1' || (mod && e.shiftKey && e.key.toLowerCase() === 'p')) {
    e.preventDefault();
    togglePalette();
    return;
  }
  if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    changeSetting('wordWrap', !settings.wordWrap);
    return;
  }
  if (!mod) return;

  const k = e.key;
  const has = !!store.active;
  if (k === 'o') { e.preventDefault(); closePalette(); void pickFiles(); }
  else if (k === 'w') { e.preventDefault(); closePalette(); if (store.active) void closeTab(store.active); }
  else if (k.toLowerCase() === 's') {
    e.preventDefault();
    if (e.shiftKey) void saveAll();
    else if (store.active) void saveTab(store.active);
  }
  else if (k === 'q') { e.preventDefault(); void getCurrentWindow().close(); }
  else if (k === 'p' && !e.shiftKey) { e.preventDefault(); if (has) void switchTab(); }
  else if (k === 'g') { e.preventDefault(); if (has) void gotoLine(); }
  else if (k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
  else if (k === 'PageDown') { e.preventDefault(); cycle(1); }
  else if (k === 'PageUp') { e.preventDefault(); cycle(-1); }
  else if (k >= '1' && k <= '9') {
    e.preventDefault();
    const tb = k === '9' ? store.tabs[store.tabs.length - 1] : store.tabs[Number(k) - 1];
    if (tb) activate(tb);
  }
  else if (k === '=' || k === '+') { e.preventDefault(); setFontSize(settings.fontSize + 1); }
  else if (k === '-') { e.preventDefault(); setFontSize(settings.fontSize - 1); }
  else if (k === '0') { e.preventDefault(); setFontSize(DEFAULTS.fontSize); }
}

export function handleWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setFontSize(settings.fontSize + (e.deltaY < 0 ? 1 : -1));
}
