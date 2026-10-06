import { fuzzy, type Match } from './fuzzy';
import * as editor from './editor';
import { store } from './tabs.svelte';

/**
 * One overlay, three uses:
 *   openList() - the command list
 *   pick()     - choose from a list of { title, detail?, value }; resolves the value or null
 *   ask()      - free-text prompt; `parse(text)` returns a value or null (Enter is ignored while null)
 */

export interface Item {
  title: string;
  /** Dim text on the right (e.g. a file path). */
  detail?: string;
  /** Shortcut, shown as keycaps, e.g. "Ctrl+Shift+Tab". */
  keys?: string;
}

interface ListSession {
  kind: 'list';
  placeholder: string;
  items: () => Item[];
  /** Index preselected while the query is empty. */
  selected?: number;
  choose: (item: Item) => void;
  cancel?: () => void;
}

interface AskSession {
  kind: 'ask';
  placeholder: string;
  parse: (text: string) => unknown;
  hint: (text: string, parsed: unknown) => string;
  choose: (value: unknown) => void;
  cancel?: () => void;
}

type Session = ListSession | AskSession;

export const pal = $state({ open: false, query: '', sel: 0, focusReq: 0 });
let session: Session | null = $state.raw(null);

export interface Row {
  item: Item;
  /** Title split into runs, with the characters the query matched flagged. */
  segs: { text: string; hit: boolean }[];
}

export interface PaletteView {
  placeholder: string;
  /** When set, shown instead of rows (prompt mode, or nothing to show). */
  hint: string | null;
  rows: Row[];
}

function segments(title: string, idx: number[]): Row['segs'] {
  const hit = new Set(idx);
  const out: Row['segs'] = [];
  [...title].forEach((ch, i) => {
    const last = out[out.length - 1];
    if (last && last.hit === hit.has(i)) last.text += ch;
    else out.push({ text: ch, hit: hit.has(i) });
  });
  return out;
}

/** Everything the overlay needs to draw, derived from the session + current query. */
export function paletteView(): PaletteView {
  const s = session;
  if (!s) return { placeholder: '', hint: null, rows: [] };
  if (s.kind === 'ask') {
    const q = pal.query;
    return { placeholder: s.placeholder, hint: s.hint(q, q.trim() ? s.parse(q) : null), rows: [] };
  }
  const rows = s.items()
    .map((item) => ({ item, m: fuzzy(pal.query, item.title) }))
    .filter((x): x is { item: Item; m: Match } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score)
    .map(({ item, m }) => ({ item, segs: segments(item.title, m.idx) }));
  return { placeholder: s.placeholder, hint: rows.length ? null : 'No matches', rows };
}

function begin(next: Session): void {
  session?.cancel?.(); // a new session replaces any still open
  session = next;
  pal.query = '';
  pal.sel = next.kind === 'list' ? (next.selected ?? 0) : 0;
  pal.open = true;
  pal.focusReq++;
}

function end(chosen: boolean): void {
  if (!pal.open) return;
  const s = session;
  session = null;
  pal.open = false;
  if (!chosen) s?.cancel?.();
  if (store.active) editor.focus();
}

export const closePalette = (): void => end(false);

export function choose(n: number): void {
  const s = session;
  if (s?.kind !== 'list') return;
  const row = paletteView().rows[n];
  if (!row) return;
  end(true);
  s.choose(row.item);
}

function accept(): void {
  const s = session;
  if (!s) return;
  if (s.kind === 'list') { choose(pal.sel); return; }
  const value = s.parse(pal.query);
  if (value == null) return;
  end(true);
  s.choose(value);
}

export function onPaletteKeydown(e: KeyboardEvent): void {
  const count = paletteView().rows.length;
  if (e.key === 'Escape') { e.preventDefault(); end(false); }
  else if (e.key === 'Enter') { e.preventDefault(); accept(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (count) pal.sel = (pal.sel + 1) % count; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (count) pal.sel = (pal.sel - 1 + count) % count; }
}

/** Show the command list; `run` is called with whichever item gets chosen. */
export function openList<T extends Item>(placeholder: string, items: () => T[], run: (item: T) => void): void {
  begin({ kind: 'list', placeholder, items, choose: (item) => run(item as T) });
}

export function pick<T>(opts: { placeholder: string; items: (Item & { value: T })[]; selected?: number }): Promise<T | null> {
  return new Promise((resolve) => begin({
    kind: 'list',
    placeholder: opts.placeholder,
    items: () => opts.items,
    selected: opts.selected,
    choose: (item) => resolve((item as Item & { value: T }).value),
    cancel: () => resolve(null),
  }));
}

export function ask<T>(opts: { placeholder: string; parse: (text: string) => T | null; hint: (text: string, parsed: T | null) => string }): Promise<T | null> {
  return new Promise((resolve) => begin({
    kind: 'ask',
    placeholder: opts.placeholder,
    parse: opts.parse,
    hint: (text, parsed) => opts.hint(text, parsed as T | null),
    choose: (v) => resolve(v as T),
    cancel: () => resolve(null),
  }));
}
