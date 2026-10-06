import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, keymap } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle, LanguageDescription, foldGutter, foldKeymap, bracketMatching } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { settings } from './config.svelte';
import { createFindPanel } from './findPanel';

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

const PLAIN: Lang = { support: [], label: 'Plain Text' };

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
const wrapComp = new Compartment();
const numbersComp = new Compartment();
const wrapExt = (): Extension => (settings.wordWrap ? EditorView.lineWrapping : []);
const numbersExt = (): Extension => (settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []);
const settingEffects = () => [wrapComp.reconfigure(wrapExt()), numbersComp.reconfigure(numbersExt())];

// Ctrl+G is "Go to Line" here, so drop the search panel's find-next on it (F3 still works).
const findKeys = searchKeymap.filter((k) => k.key !== 'Mod-g' && k.key !== 'Shift-Mod-g');

let view: EditorView | undefined;
let onStatus: (s: Status) => void = () => {};

export function statusOf(st: EditorState): Status {
  const head = st.selection.main.head;
  const line = st.doc.lineAt(head);
  return { pos: `Ln ${line.number}, Col ${head - line.from + 1}`, lines: `${st.doc.lines.toLocaleString()} lines` };
}

export function makeState(doc: string, lang: Lang): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      EditorState.readOnly.of(true),
      numbersComp.of(numbersExt()),
      wrapComp.of(wrapExt()),
      foldGutter({ openText: '⌄', closedText: '›' }),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true, createPanel: createFindPanel }),
      syntaxHighlighting(highlight),
      keymap.of([...findKeys, ...foldKeymap, ...defaultKeymap]),
      lang.support,
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) onStatus(statusOf(u.state));
      }),
    ],
  });
}

export function createEditor(parent: HTMLElement, statusCallback: (s: Status) => void): void {
  onStatus = statusCallback;
  view = new EditorView({ parent, state: EditorState.create({ doc: '' }) });
}

function v(): EditorView {
  if (!view) throw new Error('editor not ready');
  return view;
}

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

export const focus = (): void => view?.focus();
export const requestMeasure = (): void => view?.requestMeasure();

/** Re-apply wrap / line-number settings: to a stored state (inactive tab)... */
export const reconfigure = (state: EditorState): EditorState => state.update({ effects: settingEffects() }).state;
/** ...or to the live view (active tab). */
export const reconfigureActive = (): void => view?.dispatch({ effects: settingEffects() });

export const lineCount = (): number => v().state.doc.lines;

export function goTo(line: number, col: number): void {
  const e = v();
  const total = e.state.doc.lines;
  const l = e.state.doc.line(Math.min(Math.max(line, 1), total));
  const pos = l.from + Math.min(col - 1, l.length);
  e.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  e.focus();
}
