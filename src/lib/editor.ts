import { EditorState, Compartment, type Extension, type Text } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, keymap } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle, LanguageDescription, foldGutter, foldKeymap, bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { settings } from './config.svelte';
import { createFindPanel, openReplace } from './findPanel';

/*
 * The CodeMirror side. One EditorView is shared by all tabs; each tab keeps its own EditorState
 * and we swap them in and out. This module is imperative on purpose - the Svelte layer owns
 * everything around the editor.
 */

export interface Lang {
  support: Extension;
  label: string;
}

export interface Status {
  pos: string;
  lines: string;
}

export const PLAIN: Lang = { support: [], label: 'Plain Text' };

export async function languageFor(name: string): Promise<Lang> {
  const desc = LanguageDescription.matchFilename(languages, name);
  if (!desc) return PLAIN;
  try { return { support: await desc.load(), label: desc.name }; } catch { return PLAIN; }
}

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

/* ---------- settings-driven pieces live in compartments so they can be swapped per tab ---------- */
const langComp = new Compartment();
const wrapComp = new Compartment();
const numbersComp = new Compartment();
const wrapExt = (): Extension => (settings.wordWrap ? EditorView.lineWrapping : []);
const numbersExt = (): Extension => (settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []);
/** Editing needs the setting on AND a file we can write back faithfully (not binary, too large, or non-UTF-8). */
const editComp = new Compartment();
/** 'no': can't be written back safely; 'setting': follows the `editable` setting; 'always': e.g. Codepad's own settings file. */
export type EditMode = 'no' | 'setting' | 'always';
const editExt = (mode: EditMode): Extension => EditorState.readOnly.of(!(mode === 'always' || (mode === 'setting' && settings.editable)));
const settingEffects = (mode: EditMode) => [
  wrapComp.reconfigure(wrapExt()),
  numbersComp.reconfigure(numbersExt()),
  editComp.reconfigure(editExt(mode)),
];

/** Indent unit of a file: a tab if tab-indented lines dominate, else the smallest space indent seen (2-8). */
export function detectIndent(text: string): string {
  let tabs = 0, spaces = 0, smallest = 0;
  const lines = text.slice(0, 200_000).split('\n');
  for (const l of lines.slice(0, 2000)) {
    if (l[0] === '\t') tabs++;
    else if (l[0] === ' ') {
      const n = l.length - l.trimStart().length;
      if (l.trim() && n > 0) { spaces++; if (!smallest || n < smallest) smallest = n; }
    }
  }
  if (tabs > spaces) return '\t';
  return ' '.repeat(Math.min(8, Math.max(2, smallest || 2)));
}

// Ctrl+G is "Go to Line" here, so drop the search panel's find-next on it (F3 still works).
const findKeys = searchKeymap.filter((k) => k.key !== 'Mod-g' && k.key !== 'Shift-Mod-g');

let view: EditorView | undefined;
let onStatus: (s: Status) => void = () => {};
let onEdit: (doc: Text) => void = () => {};

export function statusOf(st: EditorState): Status {
  const head = st.selection.main.head;
  const line = st.doc.lineAt(head);
  return { pos: `Ln ${line.number}, Col ${head - line.from + 1}`, lines: `${st.doc.lines.toLocaleString()} lines` };
}

export function makeState(doc: string, lang: Lang, mode: EditMode): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      editComp.of(editExt(mode)),
      indentUnit.of(detectIndent(doc)),
      history(),
      closeBrackets(),
      indentOnInput(),
      numbersComp.of(numbersExt()),
      wrapComp.of(wrapExt()),
      foldGutter({ openText: '⌄', closedText: '›' }),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true, createPanel: createFindPanel }),
      syntaxHighlighting(highlight),
      keymap.of([{ key: 'Mod-h', run: openReplace }, ...findKeys, ...foldKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab, ...defaultKeymap]),
      langComp.of(lang.support),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) onStatus(statusOf(u.state));
        if (u.docChanged) onEdit(u.state.doc);
      }),
    ],
  });
}

export function createEditor(parent: HTMLElement, statusCallback: (s: Status) => void, editCallback: (doc: Text) => void): void {
  onStatus = statusCallback;
  onEdit = editCallback;
  view = new EditorView({ parent, state: EditorState.create({ doc: '' }) });
}

function v(): EditorView {
  if (!view) throw new Error('editor not ready');
  return view;
}

/** The live state of the tab on screen. */
export const currentState = (): EditorState => v().state;

/** Snapshot of what's on screen, to save back into the tab being switched away from. */
export function stash(): { state: EditorState; scroll: number } {
  return { state: v().state, scroll: v().scrollDOM.scrollTop };
}

export function show(state: EditorState, scroll: number): void {
  const e = v();
  e.setState(state);
  e.scrollDOM.scrollTop = scroll;
  requestAnimationFrame(() => { e.scrollDOM.scrollTop = scroll; e.focus(); });
  onStatus(statusOf(state));
}

/** Swap in new content for the tab already on screen, keeping the scroll position. */
export function replaceState(state: EditorState): void {
  const e = v();
  const scroll = e.scrollDOM.scrollTop;
  e.setState(state);
  e.scrollDOM.scrollTop = scroll;
  onStatus(statusOf(state));
}

/** Switch the on-screen tab's language (after Save As gives an untitled file a name). */
export const setLanguageActive = (lang: Lang): void => view?.dispatch({ effects: langComp.reconfigure(lang.support) });

export const focus = (): void => view?.focus();
export const requestMeasure = (): void => view?.requestMeasure();

/** Re-apply wrap / line-number / editable settings: to a stored state (inactive tab)... */
export const reconfigure = (state: EditorState, mode: EditMode): EditorState =>
  state.update({ effects: settingEffects(mode) }).state;
/** ...or to the live view (active tab). */
export const reconfigureActive = (mode: EditMode): void => view?.dispatch({ effects: settingEffects(mode) });

export const lineCount = (): number => v().state.doc.lines;

export function goTo(line: number, col: number): void {
  const e = v();
  const total = e.state.doc.lines;
  const l = e.state.doc.line(Math.min(Math.max(line, 1), total));
  const pos = l.from + Math.min(col - 1, l.length);
  e.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  e.focus();
}
