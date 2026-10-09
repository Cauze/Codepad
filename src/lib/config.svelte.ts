import { invoke } from '@tauri-apps/api/core';
import { MINIMAP_DEFAULTS, type MinimapOptions } from './minimap';

/*
 * Two files live in %APPDATA%\Codepad:
 *   settings.json - preferences, meant to be hand-edited (changes are picked up live)
 *   state.json    - things the app remembers for you (open tabs, recent files)
 */

export type Theme = 'system' | 'dark' | 'light';
/** What to do at launch (when no files are passed on the command line). */
export type Startup = 'restore' | 'empty';
/** When edited files are written back without asking. */
export type AutoSave = 'off' | 'afterDelay' | 'onFocusChange';
export type CursorStyle = 'line' | 'block' | 'underline';
export type LineEnding = 'lf' | 'crlf';

export interface Settings {
  theme: Theme;
  /** Allow editing files. Off = Codepad is a pure viewer. */
  editable: boolean;
  /** "off": only on Ctrl+S; "afterDelay": shortly after you stop typing; "onFocusChange": when you switch tab or window. */
  autoSave: AutoSave;
  /** ms to wait after the last keystroke when autoSave is "afterDelay", 200-60000 */
  autoSaveDelay: number;
  /** Line endings for new files. */
  defaultLineEnding: LineEnding;
  /** "restore" reopens the tabs from last time; "empty" starts with none. */
  startup: Startup;
  /** Look for a newer release shortly after launch (it only ever shows a notice). */
  checkForUpdates: boolean;
  /** Shape of the text cursor. */
  cursorStyle: CursorStyle;
  /** Whether the cursor blinks. */
  cursorBlink: boolean;
  /** Glide the cursor to its new position instead of jumping. */
  smoothCursor: boolean;
  /** px, 9-28 */
  fontSize: number;
  /** e.g. "JetBrains Mono"; empty = built-in stack */
  fontFamily: string;
  /** multiplier of the font size, 1-3 */
  lineHeight: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  /** Code overview beside the editor; same options as VS Code's editor.minimap.* (off by default). */
  minimap: MinimapOptions;
}

export interface AppState {
  session: { paths: string[]; active: string | null };
  recent: string[];
  /** Version whose update notice was dismissed, so it isn't shown again at every launch. */
  dismissedUpdate: string | null;
  /** Last window bounds in physical pixels; max = it was maximized (x/y/w/h are then the un-maximized bounds). */
  window: { x: number; y: number; w: number; h: number; max: boolean } | null;
}

interface ConfigFile {
  path: string;
  /** null when the file doesn't exist yet */
  content: string | null;
  mtime: number;
}

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  theme: 'system',
  editable: false,
  autoSave: 'off',
  autoSaveDelay: 1000,
  defaultLineEnding: 'lf',
  startup: 'restore',
  checkForUpdates: true,
  cursorStyle: 'line',
  cursorBlink: true,
  smoothCursor: false,
  fontSize: 13.5,
  fontFamily: '',
  lineHeight: 1.6,
  wordWrap: false,
  lineNumbers: true,
  minimap: { ...MINIMAP_DEFAULTS },
});

/** Reactive: components and effects that read these re-run when they change. */
export const settings: Settings = $state({ ...DEFAULTS });
export const appState: AppState = $state({ session: { paths: [], active: null }, recent: [], dismissedUpdate: null, window: null });
export const meta = { settingsPath: '' };

let settingsMtime = 0;

/** Keep only valid values; anything missing or wrong-typed falls back to its default. */
function sanitize(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    theme: o.theme === 'system' || o.theme === 'dark' || o.theme === 'light' ? o.theme : DEFAULTS.theme,
    editable: typeof o.editable === 'boolean' ? o.editable : DEFAULTS.editable,
    autoSave: o.autoSave === 'off' || o.autoSave === 'afterDelay' || o.autoSave === 'onFocusChange' ? o.autoSave : DEFAULTS.autoSave,
    autoSaveDelay: Math.round(num(o.autoSaveDelay, 200, 60000, DEFAULTS.autoSaveDelay)),
    defaultLineEnding: o.defaultLineEnding === 'lf' || o.defaultLineEnding === 'crlf' ? o.defaultLineEnding : DEFAULTS.defaultLineEnding,
    startup: o.startup === 'restore' || o.startup === 'empty' ? o.startup : DEFAULTS.startup,
    checkForUpdates: typeof o.checkForUpdates === 'boolean' ? o.checkForUpdates : DEFAULTS.checkForUpdates,
    cursorStyle: o.cursorStyle === 'line' || o.cursorStyle === 'block' || o.cursorStyle === 'underline' ? o.cursorStyle : DEFAULTS.cursorStyle,
    cursorBlink: typeof o.cursorBlink === 'boolean' ? o.cursorBlink : DEFAULTS.cursorBlink,
    smoothCursor: typeof o.smoothCursor === 'boolean' ? o.smoothCursor : DEFAULTS.smoothCursor,
    fontSize: num(o.fontSize, 9, 28, DEFAULTS.fontSize),
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily.trim() : DEFAULTS.fontFamily,
    lineHeight: num(o.lineHeight, 1, 3, DEFAULTS.lineHeight),
    wordWrap: typeof o.wordWrap === 'boolean' ? o.wordWrap : DEFAULTS.wordWrap,
    lineNumbers: typeof o.lineNumbers === 'boolean' ? o.lineNumbers : DEFAULTS.lineNumbers,
    minimap: sanitizeMinimap(o.minimap),
  };
}

function sanitizeMinimap(raw: unknown): MinimapOptions {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = MINIMAP_DEFAULTS;
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  return {
    enabled: typeof m.enabled === 'boolean' ? m.enabled : d.enabled,
    side: m.side === 'left' || m.side === 'right' ? m.side : d.side,
    showSlider: m.showSlider === 'always' || m.showSlider === 'mouseover' ? m.showSlider : d.showSlider,
    renderCharacters: typeof m.renderCharacters === 'boolean' ? m.renderCharacters : d.renderCharacters,
    maxColumn: Math.round(num(m.maxColumn, 1, 500, d.maxColumn)),
    scale: Math.round(num(m.scale, 1, 3, d.scale)),
    size: m.size === 'proportional' || m.size === 'fill' || m.size === 'fit' ? m.size : d.size,
  };
}

/** Returns false (and leaves `settings` alone) if the text isn't valid JSON. */
function applySettingsText(text: string): boolean {
  try {
    Object.assign(settings, sanitize(JSON.parse(text)));
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(): Promise<void> {
  const s = await invoke<ConfigFile>('read_config', { name: 'settings.json' });
  meta.settingsPath = s.path;
  settingsMtime = s.mtime;
  if (s.content == null) {
    await flushSettings(); // create it so the file is easy to find
  } else if (!applySettingsText(s.content)) {
    // Hand-edited into something unparseable: keep a copy, run on defaults.
    await invoke('write_config', { name: 'settings.invalid.json', content: s.content });
  }

  try {
    const st = await invoke<ConfigFile>('read_config', { name: 'state.json' });
    const j = (st.content ? JSON.parse(st.content) : {}) as Partial<AppState>;
    const strings = (a: unknown): string[] => (Array.isArray(a) ? a.filter((p): p is string => typeof p === 'string') : []);
    appState.recent = strings(j.recent).slice(0, 8);
    appState.dismissedUpdate = typeof j.dismissedUpdate === 'string' ? j.dismissedUpdate : null;
    const w = j.window;
    const int = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    appState.window = w && int(w.x) && int(w.y) && int(w.w) && int(w.h) && w.w >= 300 && w.h >= 200
      ? { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h), max: w.max === true }
      : null;
    appState.session = {
      paths: strings(j.session?.paths),
      active: typeof j.session?.active === 'string' ? j.session.active : null,
    };
  } catch { /* corrupt state is just forgotten */ }
}

async function flushSettings(): Promise<void> {
  settingsMtime = await invoke<number>('write_config', {
    name: 'settings.json',
    content: JSON.stringify($state.snapshot(settings), null, 2) + '\n',
  });
}

function debounced(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

export const saveSettings = debounced(() => { flushSettings().catch(console.error); }, 250);
export const saveState = debounced(() => {
  invoke('write_config', { name: 'state.json', content: JSON.stringify($state.snapshot(appState)) }).catch(console.error);
}, 400);

export function changeSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (settings[key] === value) return;
  settings[key] = value;
  saveSettings();
}

export function changeMinimap(patch: Partial<MinimapOptions>): void {
  settings.minimap = { ...settings.minimap, ...patch };
  saveSettings();
}

export const setFontSize = (v: number): void =>
  changeSetting('fontSize', Math.min(28, Math.max(9, Math.round(v * 2) / 2)));

/** Re-reads settings.json if it changed on disk. Resolves true when new settings were applied. */
export async function pollSettings(): Promise<boolean> {
  if (!meta.settingsPath) return false;
  let m: number;
  try { m = await invoke<number>('file_mtime', { path: meta.settingsPath }); } catch { return false; }
  if (m === settingsMtime) return false;
  const s = await invoke<ConfigFile>('read_config', { name: 'settings.json' });
  settingsMtime = s.mtime;
  return s.content != null && applySettingsText(s.content); // mid-edit/invalid: ignore until it parses
}
