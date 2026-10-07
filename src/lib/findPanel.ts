import { EditorSelection, type EditorState } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, setSearchQuery } from '@codemirror/search';

/*
 * A VS Code-style find widget, plugged into CodeMirror's search via `search({ createPanel })`.
 * CodeMirror still owns the query state, match highlighting and next/previous; this is only the UI.
 * The replace row only exists while the file is editable.
 */

const MAX_COUNT = 10_000; // stop counting here so a huge file with a one-letter query stays responsive

const svg = (path: string) =>
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICON = {
  up: svg('<path d="M3.5 10 8 5.5 12.5 10"/>'),
  down: svg('<path d="M3.5 6 8 10.5 12.5 6"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  right: svg('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  expanded: svg('<path d="M3.5 6 8 10.5 12.5 6"/>'),
};

let replaceOpen = false; // remembered across panels, like VS Code
const panels = new WeakMap<EditorView, { showReplace(): void }>();

/** Ctrl+H: open find with the replace row expanded and focus it. No-op while the file is read-only. */
export function openReplace(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  openSearchPanel(view);
  panels.get(view)?.showReplace();
  return true;
}

function button(label: string, title: string, html?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  if (html) b.innerHTML = html; // only our own static icons
  else b.textContent = label;
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  return b;
}

export function createFindPanel(view: EditorView): Panel {
  const initial = getSearchQuery(view.state);
  let caseSensitive = initial.caseSensitive;
  let regexp = initial.regexp;
  let wholeWord = initial.wholeWord;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Find';
  input.value = initial.search;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('main-field', 'true'); // CodeMirror's Ctrl+F looks for this to refocus us
  input.setAttribute('aria-label', 'Find');

  const bCase = button('Aa', 'Match Case (Alt+C)');
  const bWord = button('ab', 'Match Whole Word (Alt+W)');
  const bRegex = button('.*', 'Use Regular Expression (Alt+R)');
  const box = document.createElement('div');
  box.className = 'find-box';
  box.append(input, bCase, bWord, bRegex);

  const rInput = document.createElement('input');
  rInput.type = 'text';
  rInput.placeholder = 'Replace';
  rInput.value = initial.replace;
  rInput.spellcheck = false;
  rInput.autocomplete = 'off';
  rInput.setAttribute('aria-label', 'Replace');
  const rBox = document.createElement('div');
  rBox.className = 'find-box';
  rBox.append(rInput);
  const bReplace = button('Replace', 'Replace (Enter)');
  const bAll = button('All', 'Replace All (Ctrl+Alt+Enter)');
  bReplace.classList.add('txt');
  bAll.classList.add('txt');
  const rRow = document.createElement('div');
  rRow.className = 'find-row';
  rRow.append(rBox, bReplace, bAll);

  const bToggle = button('', 'Toggle Replace (Ctrl+H)', ICON.right);
  bToggle.classList.add('find-toggle');

  const count = document.createElement('span');
  count.className = 'find-count';
  count.setAttribute('aria-live', 'polite');

  const bPrev = button('', 'Previous Match (Shift+Enter)', ICON.up);
  const bNext = button('', 'Next Match (Enter)', ICON.down);
  const bClose = button('', 'Close (Escape)', ICON.close);

  const fRow = document.createElement('div');
  fRow.className = 'find-row';
  fRow.append(box, count, bPrev, bNext, bClose);
  const rows = document.createElement('div');
  rows.className = 'find-rows';
  rows.append(fRow, rRow);

  const dom = document.createElement('div');
  dom.className = 'find';
  dom.append(bToggle, rows);

  const currentQuery = () => new SearchQuery({ search: input.value, caseSensitive, regexp, wholeWord, literal: true, replace: rInput.value });

  /** Show / hide the replace controls according to whether the file can be edited. */
  function syncEditable(state: EditorState): void {
    const editable = !state.readOnly;
    bToggle.hidden = !editable;
    rRow.hidden = !(editable && replaceOpen);
    bToggle.innerHTML = replaceOpen ? ICON.expanded : ICON.right;
  }

  /** Select the first match at or after the cursor (like VS Code does while you type). */
  function jumpToNearest(): void {
    const q = getSearchQuery(view.state);
    if (!q.valid) return;
    let r = q.getCursor(view.state, view.state.selection.main.from).next();
    if (r.done) r = q.getCursor(view.state).next();
    if (r.done) return;
    view.dispatch({
      selection: EditorSelection.single(r.value.from, r.value.to),
      effects: EditorView.scrollIntoView(r.value.from, { y: 'nearest', x: 'nearest' }),
      userEvent: 'select.search',
    });
  }

  function commit(): void {
    view.dispatch({ effects: setSearchQuery.of(currentQuery()) });
    jumpToNearest();
  }

  function refresh(state: EditorState): void {
    const q = getSearchQuery(state);
    bCase.classList.toggle('on', q.caseSensitive);
    bWord.classList.toggle('on', q.wholeWord);
    bRegex.classList.toggle('on', q.regexp);

    let text = '';
    let bad = false;
    let hasMatches = false;
    if (q.search) {
      if (!q.valid) {
        text = 'Invalid regex';
        bad = true;
      } else {
        const sel = state.selection.main;
        const cur = q.getCursor(state);
        let total = 0;
        let at = 0;
        for (let r = cur.next(); !r.done && total < MAX_COUNT; r = cur.next()) {
          total++;
          if (r.value.from === sel.from && r.value.to === sel.to) at = total;
        }
        hasMatches = total > 0;
        if (!total) { text = 'No results'; bad = true; }
        else text = `${at || '?'} of ${total >= MAX_COUNT ? MAX_COUNT.toLocaleString() + '+' : total.toLocaleString()}`;
      }
    }
    count.textContent = text;
    count.classList.toggle('bad', bad);
    box.classList.toggle('bad', bad);
    bPrev.disabled = bNext.disabled = !hasMatches;
  }

  const setReplaceOpen = (open: boolean) => { replaceOpen = open; syncEditable(view.state); };
  panels.set(view, { showReplace() { setReplaceOpen(true); rInput.focus(); rInput.select(); } });

  const toggle = (which: 'case' | 'word' | 'regex') => {
    if (which === 'case') caseSensitive = !caseSensitive;
    else if (which === 'word') wholeWord = !wholeWord;
    else regexp = !regexp;
    commit();
  };

  input.addEventListener('input', commit);
  rInput.addEventListener('input', () => view.dispatch({ effects: setSearchQuery.of(currentQuery()) }));
  // Keys shared by both fields.
  const common = (e: KeyboardEvent): boolean => {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); view.focus(); }
    else if (e.altKey && k === 'c') { e.preventDefault(); toggle('case'); }
    else if (e.altKey && k === 'w') { e.preventDefault(); toggle('word'); }
    else if (e.altKey && k === 'r') { e.preventDefault(); toggle('regex'); }
    else if ((e.ctrlKey || e.metaKey) && k === 'h') { e.preventDefault(); openReplace(view); }
    else if (e.key === 'F3') { e.preventDefault(); (e.shiftKey ? findPrevious : findNext)(view); }
    else return false;
    return true;
  };
  rInput.addEventListener('keydown', (e) => {
    if (common(e)) return;
    if (e.key === 'Enter') { e.preventDefault(); (e.ctrlKey && e.altKey ? replaceAll : replaceNext)(view); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); input.focus(); input.select(); }
  });
  input.addEventListener('keydown', (e) => {
    if (common(e)) return;
    const k = e.key;
    if (k === 'Enter' && e.ctrlKey && e.altKey) { e.preventDefault(); replaceAll(view); }
    else if (k === 'Enter') { e.preventDefault(); (e.shiftKey ? findPrevious : findNext)(view); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f') { e.preventDefault(); input.select(); }
  });
  bCase.addEventListener('click', () => toggle('case'));
  bWord.addEventListener('click', () => toggle('word'));
  bRegex.addEventListener('click', () => toggle('regex'));
  bPrev.addEventListener('click', () => findPrevious(view));
  bNext.addEventListener('click', () => findNext(view));
  bClose.addEventListener('click', () => { closeSearchPanel(view); view.focus(); });
  bToggle.addEventListener('click', () => setReplaceOpen(!replaceOpen));
  bReplace.addEventListener('click', () => replaceNext(view));
  bAll.addEventListener('click', () => replaceAll(view));

  syncEditable(view.state);
  refresh(view.state);

  return {
    dom,
    top: true,
    mount() {
      input.focus();
      input.select();
    },
    update(u: ViewUpdate) {
      const queryChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)));
      if (queryChanged) {
        // Changed from outside (e.g. Ctrl+F prefilling the selected text): mirror it into the widget.
        const q = getSearchQuery(u.state);
        if (q.search !== input.value) input.value = q.search;
        if (q.replace !== rInput.value) rInput.value = q.replace;
        caseSensitive = q.caseSensitive;
        wholeWord = q.wholeWord;
        regexp = q.regexp;
      }
      if (u.startState.readOnly !== u.state.readOnly) syncEditable(u.state);
      if (queryChanged || u.docChanged || u.selectionSet) refresh(u.state);
    },
  };
}
