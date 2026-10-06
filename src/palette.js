const $ = (id) => document.getElementById(id);

/**
 * Subsequence match: every query char must appear in order. Returns the best-scoring alignment
 * (matched indices + score), found by DP so "tline" lands on the word "Line", not the l in "Toggle".
 * Scoring: +1 per char, +3 when it follows the previous match directly, +2 at the start of a word,
 * and a small penalty for starting late.
 */
function fuzzy(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, idx: [] };
  const s = text.toLowerCase();
  const n = s.length;
  let prev = [];
  const back = [];
  for (let i = 0; i < q.length; i++) {
    const cur = new Array(n).fill(-Infinity);
    const from = new Array(n).fill(-1);
    for (let j = 0; j < n; j++) {
      if (s[j] !== q[i]) continue;
      const here = 1 + (j === 0 || s[j - 1] === ' ' ? 2 : 0);
      if (i === 0) { cur[j] = here - j * 0.1; continue; }
      for (let k = 0; k < j; k++) {
        if (prev[k] === -Infinity) continue;
        const sc = prev[k] + here + (k === j - 1 ? 3 : 0);
        if (sc > cur[j]) { cur[j] = sc; from[j] = k; }
      }
    }
    back.push(from);
    prev = cur;
  }
  let end = -1, best = -Infinity;
  prev.forEach((v, j) => { if (v > best) { best = v; end = j; } });
  if (end < 0) return null;
  const idx = [];
  for (let i = q.length - 1, j = end; i >= 0; i--) { idx.unshift(j); j = back[i][j]; }
  return { score: best, idx };
}

/**
 * One overlay, three uses:
 *   open()  - the command list; getCommands() -> [{ title, keys?, run }]
 *   pick()  - choose from a list of { title, detail?, value }; resolves the value or null
 *   ask()   - free-text prompt; `parse(text)` returns a value or null (Enter is ignored while null)
 * onClose() runs whenever the overlay closes (used to give focus back to the editor).
 */
export function createPalette(getCommands, onClose) {
  const root = $('palette');
  const input = $('pal-input');
  const list = $('pal-list');
  let cfg = null;   // the session currently shown
  let items = [];
  let sel = 0;

  function draw(hint) {
    list.textContent = '';
    if (hint != null || !items.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = hint ?? 'No matches';
      list.append(li);
      return;
    }
    items.forEach((it, n) => {
      const li = document.createElement('li');
      if (n === sel) li.className = 'sel';
      const title = document.createElement('span');
      title.className = 'pt';
      const hit = new Set(it.m.idx);
      [...it.c.title].forEach((ch, i) => {
        if (hit.has(i)) { const b = document.createElement('b'); b.textContent = ch; title.append(b); }
        else title.append(ch);
      });
      li.append(title);
      if (it.c.detail) {
        const d = document.createElement('span');
        d.className = 'pd';
        d.textContent = it.c.detail;
        li.append(d);
      }
      if (it.c.keys) {
        const k = document.createElement('span');
        k.className = 'pk';
        for (const part of it.c.keys.split('+')) {
          const kbd = document.createElement('kbd');
          kbd.textContent = part;
          k.append(kbd);
        }
        li.append(k);
      }
      li.addEventListener('mousemove', () => { if (sel !== n) { sel = n; mark(); } });
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(n); });
      list.append(li);
    });
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  function mark() {
    [...list.children].forEach((li, n) => li.classList.toggle('sel', n === sel));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  function refresh(first = false) {
    const q = input.value;
    if (cfg.parse) { // prompt mode: no list, just a live hint
      items = [];
      draw(cfg.hint(q, q.trim() ? cfg.parse(q) : null));
      return;
    }
    items = cfg.items()
      .map((c) => ({ c, m: fuzzy(q, c.title) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m.score - a.m.score);
    sel = first && !q && cfg.selected != null ? cfg.selected : 0;
    draw();
  }

  function begin(next) {
    cfg?.cancel?.(); // a new session replaces any still open
    cfg = next;
    root.hidden = false;
    input.value = '';
    input.placeholder = next.placeholder;
    refresh(true);
    input.focus();
  }

  /** Hide the overlay; `chosen` says whether the session ended with a selection. */
  function end(chosen) {
    if (root.hidden) return;
    const c = cfg;
    cfg = null;
    root.hidden = true;
    if (!chosen) c?.cancel?.();
    onClose();
  }

  function choose(n) {
    const it = items[n];
    if (!it) return;
    const c = cfg;
    end(true);
    c.choose(it.c);
  }

  function accept() {
    if (!cfg.parse) { choose(sel); return; }
    const value = cfg.parse(input.value);
    if (value == null) return;
    const c = cfg;
    end(true);
    c.choose(value);
  }

  input.addEventListener('input', () => refresh());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'Enter') { e.preventDefault(); accept(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; mark(); } }
  });
  root.addEventListener('mousedown', (e) => { if (e.target === root) end(false); });

  const open = () => begin({ placeholder: 'Type a command…', items: getCommands, choose: (c) => c.run() });

  return {
    open,
    close: () => end(false),
    isOpen: () => !root.hidden,
    toggle: () => (root.hidden ? open() : end(false)),
    pick: ({ placeholder, items: list_, selected }) =>
      new Promise((resolve) => begin({
        placeholder, items: () => list_, selected,
        choose: (it) => resolve(it.value), cancel: () => resolve(null),
      })),
    ask: ({ placeholder, parse, hint }) =>
      new Promise((resolve) => begin({ placeholder, parse, hint, choose: resolve, cancel: () => resolve(null) })),
  };
}
