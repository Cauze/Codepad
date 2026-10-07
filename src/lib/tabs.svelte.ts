import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { EditorState, Text } from '@codemirror/state';
import * as editor from './editor';
import { appState, loadConfig, pollSettings, saveState, settings } from './config.svelte';
import { showDialog } from './dialog.svelte';
import { hooks, initUpdates } from './update.svelte';

interface FileData {
  path: string;
  mtime: number;
  content: string | null;
  /** Shown in place of the content when the file can't be displayed. */
  note: string | null;
  bom: boolean;
  crlf: boolean;
  /** Not valid UTF-8: shown with replacement characters, so it must not be written back. */
  lossy: boolean;
}

export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string): string => p.split(/[\\/]/).slice(-2, -1)[0] ?? '';

export class Tab {
  readonly path: string;
  readonly name: string;
  /** Modification time of the file as we last read or wrote it. */
  mtime = 0;
  /** Language label shown in the status bar. */
  lang = $state('Plain Text');
  /** The file vanished from disk. */
  missing = $state(false);
  /** Edited since the last save. */
  dirty = $state(false);
  /** Changed on disk while this tab has unsaved edits; saving will ask before overwriting. */
  stale = $state(false);
  /** Text we can write back faithfully (not binary, too large, or non-UTF-8). */
  writable = $state(false);
  bom = false;
  crlf = false;
  /** The document as last read from / written to disk; `dirty` is whether the editor differs from it. */
  saved!: Text;
  /** Saved editor state; only current while this tab is NOT the one on screen. */
  state!: EditorState;
  scroll = 0;

  constructor(path: string) {
    this.path = path;
    this.name = baseName(path);
  }

  /** Take on freshly read file contents, discarding any edits. */
  load(data: FileData, state: EditorState, lang: string): void {
    this.mtime = data.mtime;
    this.lang = lang;
    this.writable = data.content != null && !data.lossy;
    this.bom = data.bom;
    this.crlf = data.crlf;
    this.state = state;
    this.saved = state.doc;
    this.dirty = false;
    this.stale = false;
    this.missing = false;
  }
}

export const store: { tabs: Tab[]; active: Tab | null } = $state({ tabs: [], active: null });
export const status = $state({ pos: '', lines: '', flash: '', flashErr: false });

let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** A short message in the status bar (save failures and the like). */
export function flash(msg: string, err = false): void {
  status.flash = msg;
  status.flashErr = err;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { status.flash = ''; }, 6000);
}

/** Whether keystrokes in this tab change the document. */
export const canEdit = (tb: Tab | null): boolean => !!tb && tb.writable && settings.editable;

export function setStatus(s: editor.Status): void {
  status.pos = s.pos;
  status.lines = s.lines;
}

let restoring = true; // don't overwrite the saved session while it is still being reopened

function persist(): void {
  if (restoring) return;
  appState.session = { paths: store.tabs.map((t) => t.path), active: store.active?.path ?? null };
  saveState();
}

/* ---------- tabs ---------- */
export function activate(tb: Tab | null): void {
  const prev = store.active;
  if (prev && prev !== tb) {
    const s = editor.stash();
    prev.state = s.state;
    prev.scroll = s.scroll;
    if (prev.dirty && settings.autoSave === 'onFocusChange') void saveTab(prev, { auto: true });
  }
  store.active = tb;
  if (tb) editor.show(tb.state, tb.scroll);
  else setStatus({ pos: '', lines: '' });
  persist();
}

function dropTab(tb: Tab): void {
  const i = store.tabs.indexOf(tb);
  if (i < 0) return;
  clearTimeout(autoTimers.get(tb));
  autoTimers.delete(tb);
  store.tabs.splice(i, 1);
  if (store.active === tb) {
    store.active = null;
    activate(store.tabs[Math.min(i, store.tabs.length - 1)] ?? null);
  } else {
    persist();
  }
}

export async function closeTab(tb: Tab): Promise<void> {
  if (await confirmClose([tb])) dropTab(tb);
}

export async function closeAll(): Promise<void> {
  if (!(await confirmClose(store.tabs))) return;
  store.tabs.splice(0);
  store.active = null;
  activate(null);
}

/** Close every tab not in `keep` (which must include the active tab, so focus doesn't move). */
export async function closeAllExcept(keep: Tab[]): Promise<void> {
  if (!(await confirmClose(store.tabs.filter((t) => !keep.includes(t))))) return;
  store.tabs.splice(0, store.tabs.length, ...store.tabs.filter((t) => keep.includes(t)));
  persist();
}

export function cycle(dir: 1 | -1): void {
  const n = store.tabs.length;
  if (n < 2 || !store.active) return;
  activate(store.tabs[(store.tabs.indexOf(store.active) + dir + n) % n] ?? null);
}

/** Push wrap / line-number / editable settings into every open tab. */
export function applyEditorSettings(): void {
  for (const tb of store.tabs) {
    if (tb === store.active) editor.reconfigureActive(tb.writable);
    else tb.state = editor.reconfigure(tb.state, tb.writable);
  }
}

/* ---------- saving ---------- */
const docOf = (tb: Tab): Text => (tb === store.active ? editor.currentState() : tb.state).doc;
const errText = (e: unknown): string => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error');

const saving = new Map<Tab, Promise<boolean>>(); // per-tab queue, so two saves never write at once
const autoTimers = new Map<Tab, ReturnType<typeof setTimeout>>();

/** Called by the editor on every document change: tracks the dirty flag and schedules auto-save. */
export function onEdit(doc: Text): void {
  const tb = store.active;
  if (!tb) return;
  tb.dirty = !doc.eq(tb.saved);
  clearTimeout(autoTimers.get(tb));
  if (tb.dirty && settings.autoSave === 'afterDelay') {
    autoTimers.set(tb, setTimeout(() => {
      autoTimers.delete(tb);
      if (settings.autoSave === 'afterDelay' && tb.dirty && store.tabs.includes(tb)) void saveTab(tb, { auto: true });
    }, settings.autoSaveDelay));
  }
}

/**
 * Write a tab's document to its file. `auto` saves never ask questions: they just skip (and say why).
 * Resolves false if nothing was written for a reason the user should know about.
 */
export function saveTab(tb: Tab, opts: { auto?: boolean; force?: boolean } = {}): Promise<boolean> {
  const run = (saving.get(tb) ?? Promise.resolve(true)).then(() => doSave(tb, opts));
  saving.set(tb, run);
  void run.finally(() => { if (saving.get(tb) === run) saving.delete(tb); });
  return run;
}

async function doSave(tb: Tab, { auto = false, force = false }): Promise<boolean> {
  if (!tb.dirty) return true;
  if (!tb.writable) return false;
  const doc = docOf(tb);
  const text = tb.crlf ? doc.toString().replace(/\n/g, '\r\n') : doc.toString();
  try {
    tb.mtime = await invoke<number>('write_file', { path: tb.path, content: text, bom: tb.bom, expectedMtime: force ? null : tb.mtime });
    tb.saved = doc;
    tb.stale = false;
    tb.missing = false;
    tb.dirty = !docOf(tb).eq(doc); // typing may have continued while the write was in flight
    return true;
  } catch (e) {
    if (e === 'CONFLICT') {
      tb.stale = true;
      if (auto) { flash(`${tb.name} changed on disk, so it wasn't auto-saved`, true); return false; }
      if (tb !== store.active) activate(tb);
      const pick = await showDialog({
        title: `${tb.name} changed on disk`,
        message: 'It was modified outside Codepad after you opened it. Saving will overwrite those changes.',
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Overwrite', value: 'overwrite', primary: true, danger: true },
        ],
      });
      return pick === 'overwrite' ? doSave(tb, { auto, force: true }) : false;
    }
    if (auto) { flash(`Couldn't save ${tb.name}: ${errText(e)}`, true); return false; }
    await showDialog({ title: `Couldn't save ${tb.name}`, message: errText(e), buttons: [{ label: 'OK', value: 'ok', primary: true }] });
    return false;
  }
}

export async function saveAll(auto = false): Promise<boolean> {
  let ok = true;
  for (const tb of store.tabs) if (tb.dirty && !(await saveTab(tb, { auto }))) ok = false;
  return ok;
}

/** Make sure closing `tabs` loses nothing: true = go ahead, false = the user cancelled (or a save failed). */
export async function confirmClose(tabs: Tab[]): Promise<boolean> {
  if (!tabs.some((t) => t.dirty)) return true;
  if (settings.autoSave !== 'off') for (const tb of tabs) if (tb.dirty) await saveTab(tb, { auto: true }); // anything still dirty is asked about below
  const left = tabs.filter((t) => t.dirty);
  const first = left[0];
  if (!first) return true;
  const one = left.length === 1;
  if (one && first !== store.active) activate(first);
  const choice = await showDialog({
    title: one ? `Save changes to ${first.name}?` : `Save changes to ${left.length} files?`,
    message: one ? "Your changes will be lost if you don't save them." : "Your changes will be lost if you don't save them:",
    items: one ? [] : left.map((t) => t.name),
    buttons: [
      { label: one ? 'Save' : 'Save All', value: 'save', primary: true },
      { label: "Don't Save", value: 'discard' },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (choice === 'discard') return true;
  if (choice !== 'save') return false;
  for (const tb of left) if (!(await saveTab(tb))) return false;
  return true;
}

/** Throw away unsaved edits and re-read the file from disk. */
export async function revertTab(tb: Tab): Promise<void> {
  if (tb.dirty) {
    if (tb !== store.active) activate(tb);
    const pick = await showDialog({
      title: `Discard changes to ${tb.name}?`,
      message: 'The file will be reloaded from disk.',
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard Changes', value: 'discard', primary: true, danger: true }],
    });
    if (pick !== 'discard') return;
  }
  try { await reloadTab(tb); } catch (e) { flash(`Couldn't reload ${tb.name}: ${errText(e)}`, true); }
}

/* ---------- files ---------- */
async function readInto(path: string) {
  const data = await invoke<FileData>('read_file', { path });
  const lang = data.note != null ? { support: [], label: 'Plain Text' } : await editor.languageFor(baseName(path));
  const writable = data.content != null && !data.lossy;
  return { data, lang, state: editor.makeState(data.note ?? data.content ?? '', lang, writable) };
}

async function reloadTab(tb: Tab): Promise<void> {
  const { data, lang, state } = await readInto(tb.path);
  tb.load(data, state, lang.label);
  if (tb === store.active) editor.replaceState(state);
}

const pending = new Map<string, Promise<void>>(); // canonical path -> in-flight open, so racing opens share one tab

export async function openPath(rawPath: string): Promise<void> {
  const path = await invoke<string>('canonical_path', { path: rawPath });
  const key = path.toLowerCase();
  const existing = store.tabs.find((t) => t.path.toLowerCase() === key);
  if (existing) { activate(existing); return; }
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const job = (async () => {
    try {
      const { data, lang, state } = await readInto(path);
      const tb = new Tab(data.path);
      tb.load(data, state, lang.label);
      store.tabs.push(tb);
      pushRecent(data.path);
      activate(tb);
    } catch (e) {
      console.error(e);
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const p of paths) await openPath(p);
}

export async function pickFiles(): Promise<void> {
  const sel = await openDialog({ multiple: true });
  if (!sel) return;
  await openPaths(Array.isArray(sel) ? sel : [sel]);
}

function pushRecent(path: string): void {
  appState.recent = [path, ...appState.recent.filter((p) => p !== path)].slice(0, 8);
  saveState();
}

/* ---------- reload on change ---------- */
async function checkChanged(list: Tab[]): Promise<void> {
  for (const tb of list) {
    let m: number | null;
    try { m = await invoke<number>('file_mtime', { path: tb.path }); } catch { m = null; }
    if (m === null) { tb.missing = true; continue; }
    tb.missing = false;
    if (m === tb.mtime) continue;
    if (tb.dirty) { tb.stale = true; continue; } // never replace text the user has edited
    try {
      await reloadTab(tb);
    } catch { /* file mid-write; try again next tick */ }
  }
}

/** Polls the active tab and settings.json; on window focus, re-checks every tab. */
export function startWatching(onSettingsChanged: () => void): void {
  const checkSettings = async () => { if (await pollSettings()) onSettingsChanged(); };
  setInterval(() => {
    if (document.hidden) return;
    if (store.active) void checkChanged([store.active]);
    void checkSettings();
  }, 1500);
  window.addEventListener('focus', () => { void checkChanged(store.tabs); void checkSettings(); });
}

/* ---------- startup ---------- */
export async function boot(): Promise<void> {
  const win = getCurrentWindow();
  await loadConfig();

  const fromArgs = await invoke<string[]>('initial_files');
  if (fromArgs.length) {
    await openPaths(fromArgs);
  } else if (settings.startup === 'restore') {
    const s = { ...appState.session };
    for (const p of s.paths) await openPath(p).catch(() => {});
    const a = store.tabs.find((t) => t.path === s.active);
    if (a) activate(a);
  }
  restoring = false;
  persist();

  hooks.beforeInstall = () => confirmClose(store.tabs);
  window.addEventListener('blur', () => { if (settings.autoSave === 'onFocusChange') void saveAll(true); });
  let closing = false;
  void win.onCloseRequested(async (e) => {
    e.preventDefault();
    if (closing) return;
    closing = true;
    try { if (await confirmClose(store.tabs)) await win.destroy(); } finally { closing = false; }
  });

  void getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === 'drop') void openPaths(e.payload.paths);
  });
  void listen<string[]>('open-files', (e) => openPaths(e.payload));
  await win.show();
  void initUpdates();
}
