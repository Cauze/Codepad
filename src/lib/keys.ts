import { getCurrentWindow } from '@tauri-apps/api/window';
import { DEFAULTS, changeSetting, meta, setFontSize, settings } from './config.svelte';
import { dlg } from './dialog.svelte';
import { gotoLine, switchTab, togglePalette } from './commands';
import { closePalette } from './palette.svelte';
import { openSearch } from './searchTabs.svelte';
import { togglePreview } from './markdown.svelte';
import { activate, closeTab, cycle, newFile, openPath, pickFiles, saveAll, saveTab, saveTabAs, store } from './tabs.svelte';
import { hasMod, isMac, letter } from './platform';

export function handleKeydown(e: KeyboardEvent): void {
  if (dlg.open) return; // the dialog handles its own keys
  const mod = hasMod(e);

  if (e.key === 'F1' || (mod && e.shiftKey && e.key.toLowerCase() === 'p')) {
    e.preventDefault();
    togglePalette();
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && letter(e) === 'z') {
    e.preventDefault();
    changeSetting('wordWrap', !settings.wordWrap);
    return;
  }
  // Control+Tab / Control+Page Up/Down switch tabs on every platform (on a Mac Cmd is the shortcut key, Control is separate)
  if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) {
    e.preventDefault();
    cycle(e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1);
    return;
  }
  if (!mod) return;

  const k = e.key;
  const l = letter(e);
  const has = !!store.active;
  // Plain Cmd/Ctrl+letter. On a Mac Option changes what a letter means, so those combinations are left alone there.
  const plain = !e.shiftKey && !(isMac && e.altKey);
  if (e.altKey && !e.shiftKey && l === 's') { e.preventDefault(); void saveAll(); return; }
  if (l === 'n' && !e.shiftKey && !e.altKey) { e.preventDefault(); closePalette(); newFile(); }
  else if (l === 'v' && e.shiftKey && !e.altKey) { e.preventDefault(); togglePreview(store.active); }
  else if (l === 'f' && e.shiftKey && !e.altKey) { e.preventDefault(); openSearch(); }
  else if (l === 'o' && plain) { e.preventDefault(); closePalette(); void pickFiles(); }
  else if (l === 'w' && plain) { e.preventDefault(); closePalette(); if (store.active) void closeTab(store.active); }
  else if (l === 's') {
    e.preventDefault();
    if (e.shiftKey) { if (store.active?.writable) void saveTabAs(store.active); }
    else if (store.active) void saveTab(store.active);
  }
  else if (l === 'q' && plain) { e.preventDefault(); void getCurrentWindow().close(); }
  else if (l === 'p' && !e.shiftKey) { e.preventDefault(); if (has) void switchTab(); }
  else if (l === 'g' && plain) { e.preventDefault(); if (has) void gotoLine(); }
  else if (k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
  else if (k === 'PageDown') { e.preventDefault(); cycle(1); }
  else if (k === 'PageUp') { e.preventDefault(); cycle(-1); }
  else if (isMac && e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); cycle(e.code === 'BracketRight' ? 1 : -1); }
  else if (isMac && k === ',' && !e.shiftKey && !e.altKey) { e.preventDefault(); void openPath(meta.settingsPath); }
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
