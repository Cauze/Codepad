/*
 * The few places where macOS and Windows differ for the page: which key is the shortcut key, how
 * shortcuts are written, and what the file manager is called.
 */

export const isMac = /Mac/i.test(navigator.userAgent);

/** The shortcut key was held: Cmd on a Mac, Ctrl elsewhere. */
export const hasMod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey || e.metaKey);

/**
 * The letter a key press stands for, lowercase. Holding Option on a Mac turns letters into other characters
 * (Option+Z gives "Ω"), so fall back to the physical key when the character isn't a plain letter.
 */
export function letter(e: KeyboardEvent): string {
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) return k;
  const m = /^Key([A-Z])$/.exec(e.code);
  return m?.[1] ? m[1].toLowerCase() : k;
}

const GLYPH: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' };
/** Mac order: Control, Option, Shift, Command. */
const MAC_ORDER = ['Alt', 'Shift', 'Ctrl'];
/** Shortcuts that really are the Control key on a Mac (everything else written Ctrl is Cmd there). */
const STAYS_CTRL = new Set(['Ctrl+Tab', 'Ctrl+Shift+Tab']);

/** "Ctrl+Shift+V" as the keys to show: ["Ctrl", "Shift", "V"] on Windows, ["⇧", "⌘", "V"] on a Mac. */
export function keyCaps(keys: string): string[] {
  const parts = keys.split('+');
  if (!isMac) return parts;
  const key = parts.pop() ?? '';
  if (STAYS_CTRL.has(keys)) return ['⌃', ...parts.filter((m) => m !== 'Ctrl').map((m) => GLYPH[m] ?? m), key];
  const order = (m: string) => MAC_ORDER.indexOf(m);
  return [...parts.sort((a, b) => order(a) - order(b)).map((m) => GLYPH[m] ?? m), key];
}

/** Rewrites shortcuts mentioned in a sentence for this platform: "(Ctrl+Alt+Enter)" becomes "(⌥⌘Enter)" on a Mac. */
export function fmt(text: string): string {
  if (!isMac) return text;
  return text.replace(/(?:(?:Ctrl|Alt|Shift)\+)+[^\s)]+/g, (m) => keyCaps(m).join(''));
}

/** What the platform calls its file manager. */
export const fileManager = isMac ? 'Finder' : 'Explorer';
