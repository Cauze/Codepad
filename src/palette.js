const $ = (id) => document.getElementById(id);

/** Subsequence match: every query char must appear in order. Returns matched indices + a score. */
function fuzzy(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, idx: [] };
  const s = text.toLowerCase();
  const idx = [];
  let score = 0, last = -2, from = 0;
  for (const ch of q) {
    const i = s.indexOf(ch, from);
    if (i < 0) return null;
    idx.push(i);
    score += 1;
    if (i === last + 1) score += 3;                 // consecutive run
    if (i === 0 || s[i - 1] === ' ') score += 2;    // start of a word
    last = i;
    from = i + 1;
  }
  return { score: score - idx[0] * 0.1, idx };
}

/**
 * getCommands() -> [{ title, keys?, run }] for the commands currently available.
 * onClose() is called whenever the palette closes (used to give focus back to the editor).
 */
export function createPalette(getCommands, onClose) {
  const root = $('palette');
  const input = $('pal-input');
  const list = $('pal-list');
  let items = [];
  let sel = 0;

  function draw() {
    list.textContent = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'No matching commands';
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
      li.addEventListener('mousedown', (e) => { e.preventDefault(); run(n); });
      list.append(li);
    });
  }

  function mark() {
    [...list.children].forEach((li, n) => li.classList.toggle('sel', n === sel));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  function refresh() {
    const q = input.value;
    items = getCommands()
      .map((c) => ({ c, m: fuzzy(q, c.title) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m.score - a.m.score);
    sel = 0;
    draw();
  }

  function run(n) {
    const it = items[n];
    if (!it) return;
    close();
    it.c.run();
  }

  function open() {
    root.hidden = false;
    input.value = '';
    refresh();
    input.focus();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    onClose();
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; mark(); } }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; mark(); } }
  });
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });

  return { open, close, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : close()) };
}
