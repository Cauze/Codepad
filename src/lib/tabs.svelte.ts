import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { EditorState } from '@codemirror/state';
import * as editor from './editor';
import { appState, loadConfig, pollSettings, saveState, settings } from './config.svelte';

interface FileData {
  path: string;
  mtime: number;
  content: string | null;
  /** Shown in place of the content when the file can't be displayed. */
  note: string | null;
}

export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string): string => p.split(/[\\/]/).slice(-2, -1)[0] ?? '';

export class Tab {
  readonly path: string;
  readonly name: string;
  mtime: number;
  /** Language label shown in the status bar. */
  lang = $state('Plain Text');
  /** The file vanished from disk. */
  missing = $state(false);
  /** Saved editor state; only current while this tab is NOT the one on screen. */
  state: EditorState;
  scroll = 0;

  constructor(path: string, mtime: number, state: EditorState, lang: string) {
    this.path = path;
    this.name = baseName(path);
    this.mtime = mtime;
    this.state = state;
    this.lang = lang;
  }
}

export const store: { tabs: Tab[]; active: Tab | null } = $state({ tabs: [], active: null });
export const status = $state({ pos: '', lines: '' });

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
  }
  store.active = tb;
  if (tb) {
    editor.show(tb.state, tb.scroll);
    document.title = `${tb.name} — Codepad`;
  } else {
    setStatus({ pos: '', lines: '' });
    document.title = 'Codepad';
  }
  persist();
}

export function closeTab(tb: Tab): void {
  const i = store.tabs.indexOf(tb);
  if (i < 0) return;
  store.tabs.splice(i, 1);
  if (store.active === tb) {
    store.active = null;
    activate(store.tabs[Math.min(i, store.tabs.length - 1)] ?? null);
  } else {
    persist();
  }
}

export function closeAll(): void {
  store.tabs.splice(0);
  store.active = null;
  activate(null);
}

/** Close every tab not in `keep` (which must include the active tab, so focus doesn't move). */
export function closeAllExcept(keep: Tab[]): void {
  store.tabs.splice(0, store.tabs.length, ...store.tabs.filter((t) => keep.includes(t)));
  persist();
}

export function cycle(dir: 1 | -1): void {
  const n = store.tabs.length;
  if (n < 2 || !store.active) return;
  activate(store.tabs[(store.tabs.indexOf(store.active) + dir + n) % n] ?? null);
}

/** Push wrap / line-number settings into every open tab. */
export function applyEditorSettings(): void {
  for (const tb of store.tabs) {
    if (tb === store.active) editor.reconfigureActive();
    else tb.state = editor.reconfigure(tb.state);
  }
}

/* ---------- files ---------- */
async function readInto(path: string) {
  const data = await invoke<FileData>('read_file', { path });
  const lang = data.note != null ? { support: [], label: 'Plain Text' } : await editor.languageFor(baseName(path));
  return { data, lang, state: editor.makeState(data.note ?? data.content ?? '', lang) };
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
      const tb = new Tab(data.path, data.mtime, state, lang.label);
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
    try {
      const { data, lang, state } = await readInto(tb.path);
      tb.mtime = data.mtime;
      tb.lang = lang.label;
      if (tb === store.active) editor.replaceState(state);
      else tb.state = state;
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

  void getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === 'drop') void openPaths(e.payload.paths);
  });
  void listen<string[]>('open-files', (e) => openPaths(e.payload));
  await win.show();
}
