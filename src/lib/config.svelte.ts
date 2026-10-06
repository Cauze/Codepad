import { invoke } from '@tauri-apps/api/core';

/*
 * Two files live in %APPDATA%\Codepad:
 *   settings.json - preferences, meant to be hand-edited (changes are picked up live)
 *   state.json    - things the app remembers for you (open tabs, recent files)
 */

export type Theme = 'system' | 'dark' | 'light';

export interface Settings {
  theme: Theme;
  /** px, 9-28 */
  fontSize: number;
  /** e.g. "JetBrains Mono"; empty = built-in stack */
  fontFamily: string;
  wordWrap: boolean;
  lineNumbers: boolean;
}

export interface AppState {
  session: { paths: string[]; active: string | null };
  recent: string[];
}

interface ConfigFile {
  path: string;
  /** null when the file doesn't exist yet */
  content: string | null;
  mtime: number;
}

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  theme: 'system',
  fontSize: 13.5,
  fontFamily: '',
  wordWrap: false,
  lineNumbers: true,
});

/** Reactive: components and effects that read these re-run when they change. */
export const settings: Settings = $state({ ...DEFAULTS });
export const appState: AppState = $state({ session: { paths: [], active: null }, recent: [] });
export const meta = { settingsPath: '' };

let settingsMtime = 0;

/** Keep only valid values; anything missing or wrong-typed falls back to its default. */
function sanitize(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    theme: o.theme === 'system' || o.theme === 'dark' || o.theme === 'light' ? o.theme : DEFAULTS.theme,
    fontSize: num(o.fontSize, 9, 28, DEFAULTS.fontSize),
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily.trim() : DEFAULTS.fontFamily,
    wordWrap: typeof o.wordWrap === 'boolean' ? o.wordWrap : DEFAULTS.wordWrap,
    lineNumbers: typeof o.lineNumbers === 'boolean' ? o.lineNumbers : DEFAULTS.lineNumbers,
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
