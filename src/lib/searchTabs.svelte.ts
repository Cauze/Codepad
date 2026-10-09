import * as editor from './editor';
import { closePalette } from './palette.svelte';
import { activate, store, tabDoc, type Tab } from './tabs.svelte';

/*
 * Ctrl+Shift+F: search the text of every open tab at once. Results are listed by file;
 * Enter / click jumps to the match.
 */

export interface Hit {
  tab: Tab;
  line: number;
  /** Document offsets of the match. */
  from: number;
  to: number;
  /** The line's text split around the match (trimmed to a sensible width). */
  before: string;
  match: string;
  after: string;
}

export interface Group {
  tab: Tab;
  hits: Hit[];
}

export const ts = $state({
  open: false,
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  /** Why the query can't run (bad regular expression). */
  error: '',
  focusReq: 0,
  sel: 0,
});

export const results: { groups: Group[]; total: number; truncated: boolean } = $state({ groups: [], total: 0, truncated: false });

const MAX_HITS = 1000;
const PER_LINE = 20;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildRegex(): RegExp | null {
  if (!ts.query) return null;
  let src = ts.regex ? ts.query : escapeRe(ts.query);
  if (ts.wholeWord) src = `\\b(?:${src})\\b`;
  try {
    const re = new RegExp(src, ts.caseSensitive ? 'gu' : 'giu');
    ts.error = '';
    return re;
  } catch {
    try {
      const re = new RegExp(src, ts.caseSensitive ? 'g' : 'gi'); // some patterns only work without the u flag
      ts.error = '';
      return re;
    } catch (e) {
      ts.error = e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '').replace(/^\/.*\/[a-z]*: /, '') : 'Invalid regular expression';
      return null;
    }
  }
}

function snippet(text: string, from: number, to: number): Pick<Hit, 'before' | 'match' | 'after'> {
  const start = Math.max(0, from - 36);
  const end = Math.min(text.length, to + 120);
  const clip = (s: string) => s.replace(/\t/g, ' ');
  return {
    before: (start > 0 ? '…' : '') + clip(text.slice(start, from)).trimStart(),
    match: clip(text.slice(from, Math.min(to, from + 200))),
    after: clip(text.slice(to, end)) + (end < text.length ? '…' : ''),
  };
}

export function runSearch(): void {
  const re = buildRegex();
  results.groups = [];
  results.total = 0;
  results.truncated = false;
  ts.sel = 0;
  if (!re) return;

  const groups: Group[] = [];
  let total = 0;
  outer: for (const tab of store.tabs) {
    if (!tab.searchable) continue;
    const doc = tabDoc(tab);
    const hits: Hit[] = [];
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (!line.length) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let perLine = 0;
      while ((m = re.exec(line.text))) {
        if (m[0].length === 0) { re.lastIndex++; continue; } // an empty match is no match
        hits.push({ tab, line: n, from: line.from + m.index, to: line.from + m.index + m[0].length, ...snippet(line.text, m.index, m.index + m[0].length) });
        if (++total >= MAX_HITS) { results.truncated = true; if (hits.length) groups.push({ tab, hits }); break outer; }
        if (++perLine >= PER_LINE) break;
      }
    }
    if (hits.length) groups.push({ tab, hits });
  }
  results.groups = groups;
  results.total = total;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Re-run shortly after the query or an option changes. */
export function searchSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 90);
}

export const flatHits = (): Hit[] => results.groups.flatMap((g) => g.hits);

export function openSearch(): void {
  closePalette();
  const sel = editor.selectedText();
  if (sel) ts.query = sel;
  ts.open = true;
  ts.focusReq++;
  runSearch();
}

export function closeSearch(refocus = true): void {
  if (!ts.open) return;
  clearTimeout(timer);
  ts.open = false;
  if (refocus) editor.focus();
}

export function jumpTo(h: Hit): void {
  if (!store.tabs.includes(h.tab)) return;
  closeSearch(false);
  if (store.active !== h.tab) activate(h.tab);
  editor.selectRange(h.from, h.to);
}

export function toggle(opt: 'caseSensitive' | 'wholeWord' | 'regex'): void {
  ts[opt] = !ts[opt];
  runSearch();
}

export function onSearchKeydown(e: KeyboardEvent): void {
  const hits = flatHits();
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (hits.length) ts.sel = (ts.sel + 1) % hits.length; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) ts.sel = (ts.sel - 1 + hits.length) % hits.length; }
  else if (e.key === 'Enter') { e.preventDefault(); const h = hits[ts.sel]; if (h) jumpTo(h); }
  else if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); toggle('caseSensitive'); }
  else if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); toggle('wholeWord'); }
  else if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); toggle('regex'); }
}
