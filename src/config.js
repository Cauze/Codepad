import { invoke } from '@tauri-apps/api/core';

/*
 * Two files live in %APPDATA%\Codepad:
 *   settings.json - preferences, meant to be hand-edited (changes are picked up live)
 *   state.json    - things the app remembers for you (open tabs, recent files)
 */

export const DEFAULTS = Object.freeze({
  theme: 'system', // "system" | "dark" | "light"
  fontSize: 13.5, // px, 9-28
  fontFamily: '', // e.g. "JetBrains Mono"; empty = built-in stack
  wordWrap: false,
  lineNumbers: true,
});

export const settings = { ...DEFAULTS };
export const state = { session: { paths: [], active: null }, recent: [] };
export let settingsPath = '';

let settingsMtime = 0;

/** Keep only valid values; anything missing or wrong-typed falls back to its default. */
function sanitize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    theme: ['system', 'dark', 'light'].includes(o.theme) ? o.theme : DEFAULTS.theme,
    fontSize: num(o.fontSize, 9, 28, DEFAULTS.fontSize),
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily.trim() : DEFAULTS.fontFamily,
    wordWrap: typeof o.wordWrap === 'boolean' ? o.wordWrap : DEFAULTS.wordWrap,
    lineNumbers: typeof o.lineNumbers === 'boolean' ? o.lineNumbers : DEFAULTS.lineNumbers,
  };
}

/** Returns false (and leaves `settings` alone) if the text isn't valid JSON. */
function applySettingsText(text) {
  try {
    Object.assign(settings, sanitize(JSON.parse(text)));
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig() {
  const s = await invoke('read_config', { name: 'settings.json' });
  settingsPath = s.path;
  settingsMtime = s.mtime;
  if (s.content == null) {
    await flushSettings(); // create it so the file is easy to find
  } else if (!applySettingsText(s.content)) {
    // Hand-edited into something unparseable: keep a copy, run on defaults.
    await invoke('write_config', { name: 'settings.invalid.json', content: s.content });
  }

  try {
    const st = await invoke('read_config', { name: 'state.json' });
    const j = st.content ? JSON.parse(st.content) : {};
    if (Array.isArray(j.recent)) state.recent = j.recent.filter((p) => typeof p === 'string').slice(0, 8);
    if (j.session && Array.isArray(j.session.paths)) {
      state.session = {
        paths: j.session.paths.filter((p) => typeof p === 'string'),
        active: typeof j.session.active === 'string' ? j.session.active : null,
      };
    }
  } catch { /* corrupt state is just forgotten */ }
}

async function flushSettings() {
  settingsMtime = await invoke('write_config', {
    name: 'settings.json',
    content: JSON.stringify(settings, null, 2) + '\n',
  });
}

function debounced(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

export const saveSettings = debounced(() => flushSettings().catch(console.error), 250);
export const saveState = debounced(
  () => invoke('write_config', { name: 'state.json', content: JSON.stringify(state) }).catch(console.error),
  400,
);

/** Re-reads settings.json if it changed on disk. Resolves true when new settings were applied. */
export async function pollSettings() {
  if (!settingsPath) return false;
  let m;
  try { m = await invoke('file_mtime', { path: settingsPath }); } catch { return false; }
  if (m === settingsMtime) return false;
  const s = await invoke('read_config', { name: 'settings.json' });
  settingsMtime = s.mtime;
  return s.content != null && applySettingsText(s.content); // mid-edit/invalid: ignore until it parses
}
