import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DEFAULTS, changeSetting, meta, setFontSize, settings, type AutoSave, type Startup, type Theme } from './config.svelte';
import * as editor from './editor';
import { ask, closePalette, openList, pal, pick, type Item } from './palette.svelte';
import { checkForUpdates, installUpdate, upd } from './update.svelte';
import { activate, closeAll, closeAllExcept, closeTab, cycle, openPath, pickFiles, revertTab, saveAll, saveTab, store } from './tabs.svelte';

export interface Command extends Item {
  /** Hidden from the palette while this returns false. */
  when?: () => boolean;
  run: () => void;
}

/* ---------- commands that need a prompt or the clipboard ---------- */
export async function switchTab(): Promise<void> {
  const tb = await pick({
    placeholder: 'Switch to file…',
    items: store.tabs.map((t) => ({ title: t.name, detail: t.path, value: t })),
    selected: store.active ? store.tabs.indexOf(store.active) : 0,
  });
  if (tb) activate(tb);
}

/** Accepts "42" or "42:7" (line:column). */
const parseLine = (text: string): { line: number; col: number } | null => {
  const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(text);
  return m ? { line: Number(m[1]), col: m[2] ? Number(m[2]) : 1 } : null;
};

export async function gotoLine(): Promise<void> {
  const total = editor.lineCount();
  const target = await ask({
    placeholder: `Go to line (1–${total.toLocaleString()}), or line:column`,
    parse: parseLine,
    hint: (text, p) =>
      p
        ? `Go to line ${Math.min(Math.max(p.line, 1), total)}${p.col > 1 ? `, column ${p.col}` : ''}`
        : text.trim()
          ? 'Enter a line number, e.g. 120 or 120:8'
          : `File has ${total.toLocaleString()} lines`,
  });
  if (target) editor.goTo(target.line, target.col);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;user-select:text';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/* ---------- the list ---------- */
const hasTab = () => !!store.active;
const manyTabs = () => store.tabs.length > 1;

const theme = (name: Theme, label: string): Command => ({
  title: `Theme: ${label}`,
  when: () => settings.theme !== name,
  run: () => changeSetting('theme', name),
});

const autoSave = (name: AutoSave, label: string): Command => ({
  title: `Auto Save: ${label}`,
  when: () => settings.autoSave !== name,
  run: () => changeSetting('autoSave', name),
});

const startup = (name: Startup, label: string): Command => ({
  title: `Startup: ${label}`,
  when: () => settings.startup !== name,
  run: () => changeSetting('startup', name),
});

export const commands: Command[] = [
  { title: 'Open File…', keys: 'Ctrl+O', run: () => void pickFiles() },
  { title: 'Switch Tab…', keys: 'Ctrl+P', when: hasTab, run: () => void switchTab() },
  { title: 'Go to Line…', keys: 'Ctrl+G', when: hasTab, run: () => void gotoLine() },
  { title: 'Next Tab', keys: 'Ctrl+Tab', when: manyTabs, run: () => cycle(1) },
  { title: 'Previous Tab', keys: 'Ctrl+Shift+Tab', when: manyTabs, run: () => cycle(-1) },

  { title: 'Save', keys: 'Ctrl+S', when: () => !!store.active?.dirty, run: () => store.active && void saveTab(store.active) },
  { title: 'Save All', keys: 'Ctrl+Shift+S', when: () => store.tabs.some((t) => t.dirty), run: () => void saveAll() },
  { title: 'Revert File', when: () => !!store.active && (store.active.dirty || store.active.stale), run: () => store.active && void revertTab(store.active) },

  { title: 'Close Current File', keys: 'Ctrl+W', when: hasTab, run: () => store.active && void closeTab(store.active) },
  { title: 'Close Other Tabs', when: manyTabs, run: () => store.active && void closeAllExcept([store.active]) },
  {
    title: 'Close Tabs to the Right',
    when: () => !!store.active && store.tabs.indexOf(store.active) < store.tabs.length - 1,
    run: () => store.active && void closeAllExcept(store.tabs.slice(0, store.tabs.indexOf(store.active) + 1)),
  },
  { title: 'Close All Files', when: () => store.tabs.length > 0, run: () => void closeAll() },

  { title: 'Copy File Path', when: hasTab, run: () => store.active && void copyText(store.active.path) },
  {
    title: 'Reveal in Explorer',
    when: hasTab,
    run: () => store.active && void invoke('reveal_in_explorer', { path: store.active.path }).catch(console.error),
  },

  { title: 'Zoom In', keys: 'Ctrl+=', run: () => setFontSize(settings.fontSize + 1) },
  { title: 'Zoom Out', keys: 'Ctrl+-', run: () => setFontSize(settings.fontSize - 1) },
  { title: 'Reset Zoom', keys: 'Ctrl+0', when: () => settings.fontSize !== DEFAULTS.fontSize, run: () => setFontSize(DEFAULTS.fontSize) },
  { title: 'Toggle Word Wrap', keys: 'Alt+Z', run: () => changeSetting('wordWrap', !settings.wordWrap) },
  { title: 'Toggle Line Numbers', run: () => changeSetting('lineNumbers', !settings.lineNumbers) },
  theme('system', 'System'),
  theme('dark', 'Dark'),
  theme('light', 'Light'),

  { title: 'Enable Editing', when: () => !settings.editable, run: () => changeSetting('editable', true) },
  { title: 'Disable Editing', when: () => settings.editable, run: () => changeSetting('editable', false) },
  autoSave('off', 'Off'),
  autoSave('afterDelay', 'After Delay'),
  autoSave('onFocusChange', 'On Focus Change'),

  startup('restore', 'Reopen Last Files'),
  startup('empty', 'Start Empty'),

  { title: 'Check for Updates', when: () => upd.phase !== 'checking' && upd.phase !== 'downloading' && upd.phase !== 'restarting', run: () => void checkForUpdates(true) },
  {
    get title() { return `Install Update${upd.info ? ` (${upd.info.version})` : ''}`; },
    when: () => (upd.phase === 'available' || upd.phase === 'error') && !!upd.info,
    run: () => void installUpdate(),
  },

  { title: 'Open Settings File', run: () => void openPath(meta.settingsPath) },
  { title: 'Close Codepad', keys: 'Ctrl+Q', run: () => void getCurrentWindow().close() },
];

export const openPalette = (): void =>
  openList('Type a command…', () => commands.filter((c) => !c.when || c.when()), (c) => c.run());

export const togglePalette = (): void => (pal.open ? closePalette() : openPalette());
