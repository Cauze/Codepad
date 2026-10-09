import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DEFAULTS, changeMinimap, changeSetting, meta, setFontSize, settings, type AutoSave, type CursorStyle, type Startup, type Theme } from './config.svelte';
import * as editor from './editor';
import { ask, closePalette, openList, pal, pick, type Item } from './palette.svelte';
import { checkForUpdates, installUpdate, upd } from './update.svelte';
import { activate, canEdit, closeAll, closeAllExcept, closeTab, cycle, newFile, openPath, pickFiles, reopenWithEncoding, revertTab, saveAll, saveTab, saveTabAs, saveWithEncoding, setLineEnding, store } from './tabs.svelte';
import { ENCODINGS, encodingLabel } from './encodings';
import { openSearch } from './searchTabs.svelte';
import { setMdView, togglePreview } from './markdown.svelte';
import { errText, notify } from './notify.svelte';

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

/** Encoding picker. `how` is "reopen" (re-read the file as…) or "save" (write it out as…). */
export async function chooseEncoding(how: 'reopen' | 'save'): Promise<void> {
  const tb = store.active;
  if (!tb) return;
  const cur = encodingLabel(tb.encoding, tb.bom);
  const opt = await pick({
    placeholder: how === 'reopen' ? 'Reopen with encoding…' : 'Save with encoding…',
    items: ENCODINGS.map((e) => ({ title: e.label, detail: e.label === cur ? 'current' : e.id, value: e })),
    selected: Math.max(0, ENCODINGS.findIndex((e) => e.label === cur)),
  });
  if (!opt) return;
  if (how === 'reopen') await reopenWithEncoding(tb, opt);
  else await saveWithEncoding(tb, opt);
}

/** What the status bar's encoding button does: ask which of the two, then which encoding. */
export async function encodingMenu(): Promise<void> {
  const tb = store.active;
  if (!tb) return;
  const how = await pick({
    placeholder: `Encoding: ${encodingLabel(tb.encoding, tb.bom)}`,
    items: [
      { title: 'Reopen with Encoding…', detail: 'Read the file again, decoded differently', value: 'reopen' as const },
      ...(canEdit(tb) ? [{ title: 'Save with Encoding…', detail: 'Write the file out in another encoding', value: 'save' as const }] : []),
    ],
  });
  if (how) await chooseEncoding(how);
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
/** Whether the Explorer right-click entry is installed (null until we've asked). */
let menuOn: boolean | null = null;
void invoke<boolean>('context_menu_enabled').then((on) => { menuOn = on; }).catch(() => {});
async function setExplorerMenu(enabled: boolean): Promise<void> {
  try {
    menuOn = await invoke<boolean>('set_context_menu', { enabled });
    notify(menuOn ? '"Open with Codepad" added to the right-click menu of text and code files.' : '"Open with Codepad" removed from the right-click menu.');
  } catch (e) {
    notify(`Couldn't change the right-click menu: ${errText(e)}`, 'error');
  }
}

/** Whether `codepad` is on the user's PATH (null until we've asked). */
let pathOn: boolean | null = null;
void invoke<boolean>('path_enabled').then((on) => { pathOn = on; }).catch(() => {});
async function setPath(enabled: boolean): Promise<void> {
  try {
    pathOn = await invoke<boolean>('set_path', { enabled });
    notify(pathOn ? 'Added "codepad" to your PATH. Open a new terminal, then try: codepad file.txt' : 'Removed "codepad" from your PATH.');
  } catch (e) {
    notify(`Couldn't change the PATH: ${errText(e)}`, 'error');
  }
}

const manyTabs = () => store.tabs.length > 1;
const isMd = () => !!store.active?.isMd;

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

const cursor = (name: CursorStyle, label: string): Command => ({
  title: `Cursor: ${label}`,
  when: () => settings.cursorStyle !== name,
  run: () => changeSetting('cursorStyle', name),
});

const startup = (name: Startup, label: string): Command => ({
  title: `Startup: ${label}`,
  when: () => settings.startup !== name,
  run: () => changeSetting('startup', name),
});

export const commands: Command[] = [
  { title: 'New File', keys: 'Ctrl+N', run: newFile },
  { title: 'Open File…', keys: 'Ctrl+O', run: () => void pickFiles() },
  { title: 'Switch Tab…', keys: 'Ctrl+P', when: hasTab, run: () => void switchTab() },
  { title: 'Go to Line…', keys: 'Ctrl+G', when: hasTab, run: () => void gotoLine() },
  { title: 'Markdown: Toggle Preview', keys: 'Ctrl+Shift+V', when: isMd, run: () => togglePreview(store.active) },
  { title: 'Markdown: Show Text and Preview Side by Side', when: () => isMd() && store.active!.view !== 'split', run: () => store.active && void setMdView(store.active, 'split') },
  { title: 'Markdown: Show Text Only', when: () => isMd() && store.active!.view !== 'code', run: () => store.active && void setMdView(store.active, 'code') },
  { title: 'Markdown: Show Preview Only', when: () => isMd() && store.active!.view !== 'preview', run: () => store.active && void setMdView(store.active, 'preview') },
  { title: 'Markdown: Open Files as Text', when: () => settings.markdownDefaultView !== 'code', run: () => changeSetting('markdownDefaultView', 'code') },
  { title: 'Markdown: Open Files Side by Side', when: () => settings.markdownDefaultView !== 'split', run: () => changeSetting('markdownDefaultView', 'split') },
  { title: 'Markdown: Open Files as Preview', when: () => settings.markdownDefaultView !== 'preview', run: () => changeSetting('markdownDefaultView', 'preview') },
  { title: 'Search in Open Files…', keys: 'Ctrl+Shift+F', when: hasTab, run: openSearch },
  { title: 'Next Tab', keys: 'Ctrl+Tab', when: manyTabs, run: () => cycle(1) },
  { title: 'Previous Tab', keys: 'Ctrl+Shift+Tab', when: manyTabs, run: () => cycle(-1) },

  { title: 'Save', keys: 'Ctrl+S', when: () => !!store.active && (store.active.dirty || store.active.untitled), run: () => store.active && void saveTab(store.active) },
  { title: 'Save As…', keys: 'Ctrl+Shift+S', when: () => !!store.active?.writable, run: () => store.active && void saveTabAs(store.active) },
  { title: 'Save All', keys: 'Ctrl+Alt+S', when: () => store.tabs.some((t) => t.dirty), run: () => void saveAll() },
  { title: 'Revert File', when: () => !!store.active && !store.active.untitled && (store.active.dirty || store.active.stale), run: () => store.active && void revertTab(store.active) },

  {
    title: 'Line Endings: LF',
    when: () => !!store.active && canEdit(store.active) && store.active.crlf,
    run: () => store.active && setLineEnding(store.active, false),
  },
  {
    title: 'Line Endings: CRLF',
    when: () => !!store.active && canEdit(store.active) && !store.active.crlf,
    run: () => store.active && setLineEnding(store.active, true),
  },
  { title: 'Reopen with Encoding…', when: () => !!store.active && !store.active.untitled, run: () => void chooseEncoding('reopen') },
  { title: 'Save with Encoding…', when: () => !!store.active && canEdit(store.active), run: () => void chooseEncoding('save') },

  { title: 'Close Current File', keys: 'Ctrl+W', when: hasTab, run: () => store.active && void closeTab(store.active) },
  { title: 'Close Other Tabs', when: manyTabs, run: () => store.active && void closeAllExcept([store.active]) },
  {
    title: 'Close Tabs to the Right',
    when: () => !!store.active && store.tabs.indexOf(store.active) < store.tabs.length - 1,
    run: () => store.active && void closeAllExcept(store.tabs.slice(0, store.tabs.indexOf(store.active) + 1)),
  },
  { title: 'Close All Files', when: () => store.tabs.length > 0, run: () => void closeAll() },

  { title: 'Copy File Path', when: () => !!store.active && !store.active.untitled, run: () => store.active && void copyText(store.active.path) },
  {
    title: 'Reveal in Explorer',
    when: () => !!store.active && !store.active.untitled,
    run: () => store.active && void invoke('reveal_in_explorer', { path: store.active.path }).catch(console.error),
  },

  { title: 'Zoom In', keys: 'Ctrl+=', run: () => setFontSize(settings.fontSize + 1) },
  { title: 'Zoom Out', keys: 'Ctrl+-', run: () => setFontSize(settings.fontSize - 1) },
  { title: 'Reset Zoom', keys: 'Ctrl+0', when: () => settings.fontSize !== DEFAULTS.fontSize, run: () => setFontSize(DEFAULTS.fontSize) },
  { title: 'Toggle Word Wrap', keys: 'Alt+Z', run: () => changeSetting('wordWrap', !settings.wordWrap) },
  { title: 'Toggle Line Numbers', run: () => changeSetting('lineNumbers', !settings.lineNumbers) },
  { title: 'Toggle Minimap', run: () => changeMinimap({ enabled: !settings.minimap.enabled }) },
  { title: 'Minimap: Show on Left', when: () => settings.minimap.side !== 'left', run: () => changeMinimap({ side: 'left' }) },
  { title: 'Minimap: Show on Right', when: () => settings.minimap.side !== 'right', run: () => changeMinimap({ side: 'right' }) },
  { title: 'Minimap: Always Show Slider', when: () => settings.minimap.showSlider !== 'always', run: () => changeMinimap({ showSlider: 'always' }) },
  { title: 'Minimap: Show Slider on Hover', when: () => settings.minimap.showSlider !== 'mouseover', run: () => changeMinimap({ showSlider: 'mouseover' }) },
  { title: 'Toggle Minimap Characters', run: () => changeMinimap({ renderCharacters: !settings.minimap.renderCharacters }) },
  cursor('line', 'Line'),
  cursor('block', 'Block'),
  cursor('underline', 'Underline'),
  { title: 'Toggle Cursor Blinking', run: () => changeSetting('cursorBlink', !settings.cursorBlink) },
  { title: 'Toggle Smooth Cursor', run: () => changeSetting('smoothCursor', !settings.smoothCursor) },
  theme('system', 'System'),
  theme('dark', 'Dark'),
  theme('light', 'Light'),

  { title: 'Enable Editing', when: () => !settings.editable, run: () => changeSetting('editable', true) },
  { title: 'Disable Editing', when: () => settings.editable, run: () => changeSetting('editable', false) },
  autoSave('off', 'Off'),
  autoSave('afterDelay', 'After Delay'),
  autoSave('onFocusChange', 'On Focus Change'),

  { title: 'Line Endings for New Files: LF', when: () => settings.defaultLineEnding !== 'lf', run: () => changeSetting('defaultLineEnding', 'lf') },
  { title: 'Line Endings for New Files: CRLF', when: () => settings.defaultLineEnding !== 'crlf', run: () => changeSetting('defaultLineEnding', 'crlf') },

  startup('restore', 'Reopen Last Files'),
  startup('empty', 'Start Empty'),

  { title: 'Check for Updates', when: () => upd.phase !== 'checking' && upd.phase !== 'downloading' && upd.phase !== 'restarting', run: () => void checkForUpdates(true) },
  {
    get title() { return `Install Update${upd.info ? ` (${upd.info.version})` : ''}`; },
    when: () => (upd.phase === 'available' || upd.phase === 'error') && !!upd.info,
    run: () => void installUpdate(),
  },

  {
    title: 'Explorer Menu: Add "Open with Codepad" for Text and Code Files',
    when: () => menuOn === false,
    run: () => void setExplorerMenu(true),
  },
  {
    title: 'Explorer Menu: Remove "Open with Codepad"',
    when: () => menuOn === true,
    run: () => void setExplorerMenu(false),
  },
  {
    title: 'Command Line: Add "codepad" to PATH',
    when: () => pathOn === false,
    run: () => void setPath(true),
  },
  {
    title: 'Command Line: Remove "codepad" from PATH',
    when: () => pathOn === true,
    run: () => void setPath(false),
  },
  { title: 'Open Settings File', run: () => void openPath(meta.settingsPath) },
  { title: 'Close Codepad', keys: 'Ctrl+Q', run: () => void getCurrentWindow().close() },
];

export const openPalette = (): void =>
  openList('Type a command…', () => commands.filter((c) => !c.when || c.when()), (c) => c.run());

export const togglePalette = (): void => (pal.open ? closePalette() : openPalette());
