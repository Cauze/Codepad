<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount, tick, untrack } from 'svelte';
  import * as editor from './lib/editor';
  import { baseDirOf, clearImageCache, loadImage, previewApi, renderMarkdown, resolveLocal } from './lib/markdown.svelte';
  import { mdSync, openPath, store, tabDoc, type Tab } from './lib/tabs.svelte';

  let el: HTMLDivElement;
  let lastTab: Tab | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renderedFor = 0;
  /** Scroll events caused by our own syncing, which must not bounce back. */
  let muteEditor = 0;
  let mutePreview = 0;

  const split = (): boolean => store.active?.view === 'split';

  /* ---------- scroll sync (by source line) ---------- */
  const blocks = (): { line: number; top: number }[] =>
    [...el.querySelectorAll<HTMLElement>(':scope > [data-line]')].map((b) => ({ line: Number(b.dataset.line), top: b.offsetTop }));

  function previewTop(line: number, frac: number): number {
    const bs = blocks();
    if (!bs.length) return 0;
    const target = line + frac;
    let i = 0;
    while (i + 1 < bs.length && bs[i + 1]!.line <= target) i++;
    const a = bs[i]!, b = bs[i + 1];
    const endLine = b ? b.line : (store.active ? tabDoc(store.active).lines + 1 : a.line + 1);
    const endTop = b ? b.top : el.scrollHeight;
    const t = endLine > a.line ? Math.min(1, Math.max(0, (target - a.line) / (endLine - a.line))) : 0;
    return a.top + t * (endTop - a.top);
  }

  function lineAtPreviewTop(): { line: number; frac: number } | null {
    const bs = blocks();
    if (!bs.length) return null;
    const y = el.scrollTop;
    let i = 0;
    while (i + 1 < bs.length && bs[i + 1]!.top <= y) i++;
    const a = bs[i]!, b = bs[i + 1];
    const endLine = b ? b.line : (store.active ? tabDoc(store.active).lines + 1 : a.line + 1);
    const endTop = b ? b.top : el.scrollHeight;
    const t = endTop > a.top ? Math.min(1, Math.max(0, (y - a.top) / (endTop - a.top))) : 0;
    const exact = a.line + t * (endLine - a.line);
    return { line: Math.floor(exact), frac: exact - Math.floor(exact) };
  }

  function followEditor(): void {
    const { line, frac } = editor.topLine();
    mutePreview = performance.now() + 80;
    el.scrollTop = previewTop(line, frac);
  }

  function followPreview(): void {
    const p = lineAtPreviewTop();
    if (!p) return;
    muteEditor = performance.now() + 80;
    editor.scrollToLine(p.line, p.frac);
  }

  /* ---------- rendering ---------- */
  async function enhance(tb: Tab, stamp: number): Promise<void> {
    const dir = baseDirOf(tb);
    for (const img of el.querySelectorAll<HTMLImageElement>('img[src]')) {
      const src = img.getAttribute('src') ?? '';
      if (/^(https?:|data:|blob:)/i.test(src)) continue;
      const path = dir || /^(file:|[a-zA-Z]:[\\/])/.test(src) ? resolveLocal(dir, src) : null;
      if (!path) continue;
      void loadImage(path).then((url) => {
        if (stamp === renderedFor && url && img.isConnected) img.src = url;
      });
    }
    for (const code of el.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
      const lang = /language-([\w+#.-]+)/.exec(code.className)?.[1];
      if (!lang) continue;
      const text = code.textContent ?? '';
      void editor.highlightCode(text, lang).then((html) => {
        if (html != null && stamp === renderedFor && code.isConnected && code.textContent === text) code.innerHTML = html;
      });
    }
  }

  function render(tb: Tab, fresh: boolean): void {
    const stamp = ++renderedFor;
    const keep = el.scrollTop;
    if (fresh) clearImageCache();
    el.innerHTML = renderMarkdown(tabDoc(tb).toString());
    mutePreview = performance.now() + 80;
    if (fresh) { if (split() || tb.view === 'preview') followEditor(); else el.scrollTop = 0; }
    else el.scrollTop = keep;
    void enhance(tb, stamp);
  }

  $effect(() => {
    void mdSync.tick;
    const tb = store.active;
    const show = !!tb && tb.isMd && tb.view !== 'code';
    void tb?.view;
    if (!show || !tb) { lastTab = null; return; }
    const fresh = tb !== lastTab || untrack(() => !el.firstChild);
    lastTab = tb;
    clearTimeout(timer);
    if (fresh) void tick().then(() => render(tb, true));
    else timer = setTimeout(() => render(tb, false), 160);
  });

  /* ---------- links ---------- */
  function onClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      const target = el.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`) as HTMLElement | null;
      if (target) el.scrollTop = target.offsetTop - 8;
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) { void invoke('open_external', { url: href }).catch(console.error); return; }
    const tb = store.active;
    const path = tb ? resolveLocal(baseDirOf(tb), href) : null;
    if (path) void openPath(path);
  }

  onMount(() => {
    previewApi.lineAtTop = lineAtPreviewTop;
    const off = editor.onScroll(() => { if (split() && performance.now() > muteEditor) followEditor(); });
    return () => { off(); previewApi.lineAtTop = null; clearTimeout(timer); };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div
  id="md"
  role="document"
  tabindex="0"
  aria-label="Markdown preview"
  bind:this={el}
  onclick={onClick}
  onscroll={() => { if (split() && performance.now() > mutePreview) followPreview(); }}
></div>
