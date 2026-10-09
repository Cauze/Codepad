import { invoke } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { Marked, type Token, type Tokens } from 'marked';
import { tick } from 'svelte';
import type { MarkdownView } from './config.svelte';
import * as editor from './editor';
import { bumpPreview, store, type Tab } from './tabs.svelte';

/*
 * Markdown preview: marked renders, DOMPurify cleans (a README can contain raw HTML).
 * Each top-level block is wrapped in <div data-line="N"> so the preview and editor can scroll together.
 */

let slugs = new Map<string, number>();

const slugify = (text: string): string => {
  const base = text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-') || 'section';
  const n = slugs.get(base) ?? 0;
  slugs.set(base, n + 1);
  return n ? `${base}-${n}` : base;
};

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }: Tokens.Heading) {
      return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

/** YAML front matter would render as a stray rule + heading; show it as a code block instead (same line count). */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function renderMarkdown(src: string): string {
  slugs = new Map();
  const text = src.replace(FRONT_MATTER, (_m, body: string) => '```yaml\n' + body + '\n```\n');
  const tokens = marked.lexer(text);
  let line = 1;
  let out = '';
  for (const tok of tokens) {
    if (tok.type !== 'space') {
      const one = Object.assign([tok] as Token[], { links: tokens.links });
      out += `<div data-line="${line}">${marked.parser(one)}</div>`;
    }
    line += (tok.raw.match(/\n/g) ?? []).length;
  }
  return DOMPurify.sanitize(out, { FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] });
}

/* ---------- local images & links ---------- */

/** Resolve `src` (relative to the Markdown file's folder) to an absolute Windows path, or null if it isn't a local file. */
export function resolveLocal(baseDir: string, src: string): string | null {
  let rel = src.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) && !/^(file:|[a-zA-Z]:[\\/])/.test(rel)) return null; // http:, data:, mailto: ...
  rel = rel.replace(/^file:\/+/i, '');
  rel = rel.split(/[?#]/)[0] ?? '';
  try { rel = decodeURIComponent(rel); } catch { /* leave it as written */ }
  if (!rel) return null;
  const absolute = /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\');
  const full = absolute ? rel : baseDir + rel;
  const unc = full.startsWith('\\\\');
  const out: string[] = [];
  for (const part of full.split(/[\\/]+/)) {
    if (part === '.' || part === '') continue;
    if (part === '..') { if (out.length > 1) out.pop(); } else out.push(part);
  }
  return (unc ? '\\\\' : '') + out.join('\\');
}

const imageCache = new Map<string, Promise<string | null>>();
export const clearImageCache = (): void => imageCache.clear();

export function loadImage(path: string): Promise<string | null> {
  let p = imageCache.get(path);
  if (!p) {
    p = invoke<string>('read_image_data', { path }).catch(() => null);
    imageCache.set(path, p);
  }
  return p;
}

/** The folder of a tab's file, with a trailing separator ('' for an unsaved file). */
export const baseDirOf = (tb: Tab): string => (tb.untitled ? '' : tb.path.slice(0, tb.path.length - tb.name.length));

/* ---------- switching views ---------- */

/** What the mounted preview offers, so a view switch can carry the reading position across. */
export const previewApi: { lineAtTop: (() => { line: number; frac: number } | null) | null } = { lineAtTop: null };

export async function setMdView(tb: Tab, view: MarkdownView): Promise<void> {
  if (!tb.isMd || tb.view === view) return;
  const from = tb.view;
  // leaving the preview-only view: remember where the reader was, then put the editor there
  const pos = from === 'preview' ? previewApi.lineAtTop?.() ?? null : null;
  tb.view = view;
  bumpPreview();
  await tick();
  editor.requestMeasure();
  if (view !== 'preview') {
    if (pos) editor.scrollToLine(pos.line, pos.frac);
    if (store.active === tb) editor.focus();
  }
}

export const togglePreview = (tb: Tab | null): void => {
  if (tb?.isMd) void setMdView(tb, tb.view === 'code' ? 'preview' : 'code');
};

