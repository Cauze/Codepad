import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, keymap } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle, LanguageDescription, foldGutter, foldKeymap, bracketMatching } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { createPalette } from './palette.js';

const $ = (id) => document.getElementById(id);
const win = getCurrentWindow();

/* ---------- syntax colours (CSS variables, so light/dark is pure CSS) ---------- */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--syn-property)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.angleBracket], color: 'var(--syn-operator)' },
  { tag: [t.tagName, t.invalid, t.deleted], color: 'var(--syn-tag)' },
  { tag: [t.variableName, t.name], color: 'var(--syn-variable)' },
  { tag: [t.meta, t.processingInstruction, t.annotation, t.inserted], color: 'var(--syn-meta)' },
  { tag: [t.heading], color: 'var(--syn-function)', fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--syn-type)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
]);

/* ---------- state ---------- */
const tabs = []; // { path, name, state, scroll, mtime, missing, lang }
let active = null;

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const baseName = (p) => p.split(/[\\/]/).pop();
const dirName = (p) => p.split(/[\\/]/).slice(-2, -1)[0] ?? '';

/* ---------- editor ---------- */
const view = new EditorView({ parent: $('editor'), state: EditorState.create({ doc: '' }) });

async function languageFor(name) {
  const desc = LanguageDescription.matchFilename(languages, name);
  if (!desc) return { support: [], label: 'Plain Text' };
  try { return { support: await desc.load(), label: desc.name }; } catch { return { support: [], label: 'Plain Text' }; }
}

function makeState(doc, lang) {
  return EditorState.create({
    doc,
    extensions: [
      EditorState.readOnly.of(true),
      lineNumbers(),
      foldGutter({ openText: '⌄', closedText: '›' }),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(highlight),
      keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap]),
      lang.support,
      EditorView.updateListener.of((u) => { if (u.selectionSet || u.docChanged) updateStatus(u.state); }),
    ],
  });
}

function updateStatus(state = view.state) {
  if (!active) { $('st-pos').textContent = $('st-lines').textContent = $('st-lang').textContent = ''; return; }
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  $('st-pos').textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
  $('st-lines').textContent = `${state.doc.lines.toLocaleString()} lines`;
  $('st-lang').textContent = active.lang;
}

/* ---------- tabs ---------- */
function renderTabs() {
  const el = $('tabs');
  el.textContent = '';
  const counts = {};
  for (const tb of tabs) counts[tb.name] = (counts[tb.name] || 0) + 1;

  for (const tb of tabs) {
    const d = document.createElement('div');
    d.className = 'tab' + (tb === active ? ' active' : '') + (tb.missing ? ' missing' : '');
    d.title = tb.path;
    d.setAttribute('role', 'tab');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = tb.name;
    if (counts[tb.name] > 1) {
      const dir = document.createElement('span');
      dir.className = 'dir';
      dir.textContent = dirName(tb.path);
      name.append(dir);
    }
    const x = document.createElement('button');
    x.className = 'x';
    x.setAttribute('aria-label', 'Close tab');
    x.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M0 0l8 8M8 0L0 8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tb); });
    d.append(name, x);
    d.addEventListener('mousedown', (e) => {
      if (e.target.closest('.x')) return; // let the close button receive its own click
      if (e.button === 1) { e.preventDefault(); closeTab(tb); }
      else if (e.button === 0) activate(tb);
    });
    el.append(d);
  }
  el.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function persist() {
  store.set('session', { paths: tabs.map((t) => t.path), active: active?.path ?? null });
}

function showEmpty() {
  const empty = !active;
  $('empty').classList.toggle('show', empty);
  $('editor').classList.toggle('hidden', empty);
  if (empty) renderRecent();
}

function activate(tb) {
  if (active && active !== tb) { active.state = view.state; active.scroll = view.scrollDOM.scrollTop; }
  active = tb;
  if (tb) {
    view.setState(tb.state);
    view.scrollDOM.scrollTop = tb.scroll || 0;
    requestAnimationFrame(() => { view.scrollDOM.scrollTop = tb.scroll || 0; view.focus(); });
    document.title = `${tb.name} — Codepad`;
  } else {
    document.title = 'Codepad';
  }
  updateStatus();
  renderTabs();
  showEmpty();
  persist();
}

function closeTab(tb) {
  const i = tabs.indexOf(tb);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (active === tb) { active = null; activate(tabs[Math.min(i, tabs.length - 1)] ?? null); }
  else { renderTabs(); persist(); }
}

function closeAll() {
  tabs.splice(0);
  active = null;
  activate(null);
}

function cycle(dir) {
  if (tabs.length < 2) return;
  activate(tabs[(tabs.indexOf(active) + dir + tabs.length) % tabs.length]);
}

/* ---------- files ---------- */
async function readInto(path) {
  const data = await invoke('read_file', { path });
  const name = baseName(path);
  let doc = data.content;
  let lang = { support: [], label: 'Plain Text' };
  if (data.note) doc = data.note;
  else lang = await languageFor(name);
  return { data, name, state: makeState(doc ?? '', lang), langLabel: lang.label };
}

const pending = new Map(); // canonical path -> in-flight open, so racing opens share one tab

async function openPath(rawPath) {
  const path = await invoke('canonical_path', { path: rawPath });
  const key = path.toLowerCase();
  const existing = tabs.find((t) => t.path.toLowerCase() === key);
  if (existing) { activate(existing); return; }
  if (pending.has(key)) return pending.get(key);

  const job = (async () => {
    try {
      const { data, name, state, langLabel } = await readInto(path);
      const tb = { path: data.path, name, state, scroll: 0, mtime: data.mtime, missing: false, lang: langLabel };
      tabs.push(tb);
      pushRecent(data.path);
      activate(tb);
    } catch (e) {
      console.error(e);
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

async function openPaths(paths) {
  for (const p of paths) await openPath(p);
}

async function pickFiles() {
  const sel = await openDialog({ multiple: true });
  if (!sel) return;
  await openPaths(Array.isArray(sel) ? sel : [sel]);
}

/* Reload tabs whose file changed on disk (poll the active tab, check all on focus). */
async function checkChanged(list) {
  for (const tb of list) {
    let m;
    try { m = await invoke('file_mtime', { path: tb.path }); } catch { m = null; }
    if (m === null) { if (!tb.missing) { tb.missing = true; renderTabs(); } continue; }
    if (tb.missing) { tb.missing = false; renderTabs(); }
    if (m === tb.mtime) continue;
    try {
      const { data, state, langLabel } = await readInto(tb.path);
      tb.mtime = data.mtime;
      tb.lang = langLabel;
      if (tb === active) {
        const scroll = view.scrollDOM.scrollTop;
        tb.state = state;
        view.setState(state);
        view.scrollDOM.scrollTop = scroll;
        updateStatus();
      } else {
        tb.state = state;
      }
    } catch { /* file mid-write; try again next tick */ }
  }
}
setInterval(() => { if (active && !document.hidden) checkChanged([active]); }, 1500);
window.addEventListener('focus', () => checkChanged(tabs));

/* ---------- recents ---------- */
function pushRecent(path) {
  const r = [path, ...store.get('recent', []).filter((p) => p !== path)].slice(0, 8);
  store.set('recent', r);
}
function renderRecent() {
  const ul = $('recent');
  ul.textContent = '';
  for (const p of store.get('recent', [])) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.textContent = baseName(p);
    const d = document.createElement('span');
    d.className = 'rp';
    d.textContent = p.slice(0, p.length - baseName(p).length);
    li.append(n, d);
    li.addEventListener('click', () => openPath(p));
    ul.append(li);
  }
}

/* ---------- zoom ---------- */
let fs = store.get('fs', 13.5);
function setFs(v) {
  fs = Math.min(28, Math.max(9, v));
  document.documentElement.style.setProperty('--fs', fs + 'px');
  store.set('fs', fs);
  view.requestMeasure();
}
setFs(fs);

/* ---------- command palette ---------- */
const commands = [
  { title: 'Open File…', keys: 'Ctrl+O', run: pickFiles },
  { title: 'Close Current File', keys: 'Ctrl+W', when: () => !!active, run: () => closeTab(active) },
  { title: 'Close All Files', when: () => tabs.length > 0, run: closeAll },
  { title: 'Close Codepad', keys: 'Ctrl+Q', run: () => win.close() },
];

const palette = createPalette(
  () => commands.filter((c) => !c.when || c.when()),
  () => { if (active) view.focus(); },
);

/* ---------- input ---------- */
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p')) {
    e.preventDefault();
    palette.toggle();
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key;
  if (k === 'o') { e.preventDefault(); palette.close(); pickFiles(); }
  else if (k === 'w') { e.preventDefault(); palette.close(); if (active) closeTab(active); }
  else if (k === 'q') { e.preventDefault(); win.close(); }
  else if (k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
  else if (k >= '1' && k <= '9') { e.preventDefault(); const tb = k === '9' ? tabs[tabs.length - 1] : tabs[+k - 1]; if (tb) activate(tb); }
  else if (k === '=' || k === '+') { e.preventDefault(); setFs(fs + 1); }
  else if (k === '-') { e.preventDefault(); setFs(fs - 1); }
  else if (k === '0') { e.preventDefault(); setFs(13.5); }
});
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) { e.preventDefault(); setFs(fs + (e.deltaY < 0 ? 1 : -1)); }
}, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());

$('add').addEventListener('click', pickFiles);
$('win-min').addEventListener('click', () => win.minimize());
$('win-max').addEventListener('click', () => win.toggleMaximize());
$('win-close').addEventListener('click', () => win.close());

getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === 'drop') openPaths(e.payload.paths);
});
listen('open-files', (e) => openPaths(e.payload));

/* ---------- boot ---------- */
(async () => {
  showEmpty();
  const fromArgs = await invoke('initial_files');
  if (fromArgs.length) {
    await openPaths(fromArgs);
  } else {
    const s = store.get('session', { paths: [], active: null });
    for (const p of s.paths) { try { await openPath(p); } catch {} }
    const a = tabs.find((t) => t.path === s.active);
    if (a) activate(a);
  }
  win.show();
})();
