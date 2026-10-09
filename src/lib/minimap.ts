import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { highlightTree, type Highlighter } from '@lezer/highlight';

/*
 * A code minimap, drawn on a canvas beside the editor (CodeMirror doesn't ship one).
 * Options mirror VS Code's editor.minimap.* settings.
 */

export interface MinimapOptions {
  enabled: boolean;
  side: 'right' | 'left';
  showSlider: 'always' | 'mouseover';
  /** true = a small block per character; false = solid bars per run of text. */
  renderCharacters: boolean;
  /** Characters per line to draw, 1-500. */
  maxColumn: number;
  /** 1-3 */
  scale: number;
  /** proportional: fixed zoom. fill: stretch short files to the full height. fit: shrink long files to fit. */
  size: 'proportional' | 'fill' | 'fit';
}

export const MINIMAP_DEFAULTS: Readonly<MinimapOptions> = Object.freeze({
  enabled: false,
  side: 'right',
  showSlider: 'mouseover',
  renderCharacters: true,
  maxColumn: 120,
  scale: 1,
  size: 'proportional',
});

const BASE_LINE = 2; // px per line at scale 1
const BASE_CHAR = 1; // px per character at scale 1

interface Token { from: number; to: number; color: string }

function makePlugin(o: MinimapOptions, style: Highlighter) {
  return ViewPlugin.fromClass(class {
    dom = document.createElement('div');
    canvas = document.createElement('canvas');
    slider = document.createElement('div');
    ctx = this.canvas.getContext('2d')!;
    colors = new Map<string, string>();
    defaultColor = '';
    width = 0;
    height = 0;
    lineH = BASE_LINE * o.scale;
    start = 1;
    raf = 0;
    drag: { grab: number } | null = null;
    ro: ResizeObserver;
    mo: MutationObserver;
    onScroll = () => this.schedule();

    constructor(readonly view: EditorView) {
      this.dom.className = `cm-minimap side-${o.side}${o.showSlider === 'always' ? ' slider-always' : ''}`;
      this.slider.className = 'cm-minimap-slider';
      this.dom.append(this.canvas, this.slider);
      view.dom.append(this.dom);
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.dom.addEventListener('pointerdown', (e) => this.down(e));
      this.dom.addEventListener('pointermove', (e) => this.move(e));
      this.dom.addEventListener('pointerup', (e) => this.up(e));
      this.dom.addEventListener('pointercancel', (e) => this.up(e));
      this.dom.addEventListener('wheel', (e) => { view.scrollDOM.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
      this.ro = new ResizeObserver(() => this.schedule());
      this.ro.observe(view.dom);
      // light/dark switches change the colours the CSS variables resolve to
      this.mo = new MutationObserver(() => { this.colors.clear(); this.schedule(); });
      this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      this.schedule();
    }

    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.heightChanged || u.transactions.length) this.schedule();
    }

    destroy(): void {
      cancelAnimationFrame(this.raf);
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      this.view.scrollDOM.style.marginLeft = '';
      this.view.scrollDOM.style.marginRight = '';
      this.ro.disconnect();
      this.mo.disconnect();
      this.dom.remove();
    }

    schedule(): void {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
    }

    /** Colour a highlight class resolves to right now (the CSS variables decide). */
    colorOf(cls: string): string {
      let c = this.colors.get(cls);
      if (c === undefined) {
        const probe = document.createElement('span');
        probe.className = cls;
        this.view.contentDOM.append(probe);
        c = getComputedStyle(probe).color;
        probe.remove();
        this.colors.set(cls, c);
      }
      return c;
    }

    layout(): void {
      const v = this.view, sd = v.scrollDOM;
      const charW = BASE_CHAR * o.scale;
      this.width = Math.round(Math.max(48, Math.min(o.maxColumn * charW + 12, v.dom.clientWidth * 0.2)));
      this.height = sd.clientHeight;
      Object.assign(this.dom.style, { width: `${this.width}px`, top: `${sd.offsetTop}px`, height: `${this.height}px` });
      sd.style.marginLeft = o.side === 'left' ? `${this.width}px` : '';
      sd.style.marginRight = o.side === 'right' ? `${this.width}px` : '';
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(this.width * dpr), ch = Math.round(this.height * dpr);
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw;
        this.canvas.height = ch;
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    render(): void {
      const v = this.view, st = v.state, doc = st.doc, sd = v.scrollDOM;
      this.layout();
      const H = this.height, total = doc.lines;
      if (H <= 0) return;

      const base = BASE_LINE * o.scale;
      this.lineH = o.size === 'fill' && total * base < H ? H / total
        : o.size === 'fit' && total * base > H ? H / total
        : base;
      const lineH = this.lineH, charW = BASE_CHAR * o.scale;
      const rows = Math.max(1, Math.floor(H / lineH));

      // which slice of the document the minimap shows: it scrolls along with the editor
      const maxScroll = Math.max(1, sd.scrollHeight - sd.clientHeight);
      const frac = Math.min(1, Math.max(0, sd.scrollTop / maxScroll));
      this.start = total <= rows ? 1 : 1 + Math.round(frac * (total - rows));
      const end = Math.min(total, this.start + rows - 1);

      this.defaultColor = getComputedStyle(v.contentDOM).color;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, H);

      const tokens: Token[] = [];
      const from = doc.line(this.start).from, to = doc.line(end).to;
      highlightTree(syntaxTree(st), style, (f, t, cls) => { tokens.push({ from: f, to: t, color: this.colorOf(cls) }); }, from, to);

      const barH = Math.max(1, Math.round(lineH * 0.6 * 10) / 10);
      let ti = 0;
      ctx.globalAlpha = 0.8;
      for (let n = this.start; n <= end; n++) {
        const line = doc.line(n);
        if (!line.length) continue;
        const y = (n - this.start) * lineH + (lineH - barH) / 2;
        const text = line.text;
        const limit = Math.min(text.length, o.maxColumn);
        while (ti < tokens.length && tokens[ti]!.to <= line.from) ti++;
        let pos = line.from;
        const lineEnd = line.from + limit;
        const paint = (a: number, b: number, color: string) => {
          if (b <= a) return;
          ctx.fillStyle = color;
          let runStart = -1;
          for (let i = a - line.from; i <= b - line.from; i++) {
            const ink = i < b - line.from && text.charCodeAt(i) > 32;
            if (o.renderCharacters) {
              if (ink) ctx.fillRect(i * charW, y, Math.max(0.6, charW * 0.8), barH);
            } else if (ink && runStart < 0) runStart = i;
            else if (!ink && runStart >= 0) { ctx.fillRect(runStart * charW, y, (i - runStart) * charW, barH); runStart = -1; }
          }
        };
        for (let j = ti; j < tokens.length && tokens[j]!.from < lineEnd; j++) {
          const tk = tokens[j]!;
          const a = Math.max(tk.from, line.from), b = Math.min(tk.to, lineEnd);
          if (a > pos) paint(pos, a, this.defaultColor);
          if (b > a) paint(Math.max(a, pos), b, tk.color);
          pos = Math.max(pos, b);
        }
        if (pos < lineEnd) paint(pos, lineEnd, this.defaultColor);
      }
      ctx.globalAlpha = 1;

      // slider = the part of the document the editor is showing
      const top = doc.lineAt(v.lineBlockAtHeight(sd.scrollTop).from).number;
      const bottom = doc.lineAt(v.lineBlockAtHeight(sd.scrollTop + sd.clientHeight).from).number;
      const sTop = Math.max(0, (top - this.start) * lineH);
      const sBot = Math.min(H, (bottom - this.start + 1) * lineH);
      Object.assign(this.slider.style, { top: `${sTop}px`, height: `${Math.max(8, sBot - sTop)}px` });
    }

    /** Scroll the editor so `line` is at the top (`center` = in the middle instead). */
    scrollToLine(line: number, center: boolean): void {
      const v = this.view, doc = v.state.doc;
      const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const block = v.lineBlockAt(l.from);
      v.scrollDOM.scrollTop = center ? block.top - v.scrollDOM.clientHeight / 2 + block.height / 2 : block.top;
    }

    lineAt(clientY: number): number {
      return this.start + Math.floor((clientY - this.dom.getBoundingClientRect().top) / this.lineH);
    }

    down(e: PointerEvent): void {
      if (e.button !== 0) return;
      e.preventDefault();
      this.dom.setPointerCapture(e.pointerId);
      const r = this.slider.getBoundingClientRect();
      if (e.target === this.slider) this.drag = { grab: e.clientY - r.top };
      else { this.drag = { grab: r.height / 2 }; this.scrollToLine(this.lineAt(e.clientY), true); }
    }

    move(e: PointerEvent): void {
      if (!this.drag) return;
      const top = e.clientY - this.drag.grab;
      this.scrollToLine(this.lineAt(top + 1), false);
    }

    up(e: PointerEvent): void {
      this.drag = null;
      if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
      this.view.focus();
    }
  });
}

/** The minimap as an editor extension (empty when it's switched off). */
export function minimapExtension(o: MinimapOptions, style: Highlighter): Extension {
  return o.enabled ? makePlugin(o, style) : [];
}
