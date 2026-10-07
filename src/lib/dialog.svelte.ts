import * as editor from './editor';

/*
 * A small modal for questions that need an answer before the app can carry on
 * ("save changes?", "file changed on disk"). Resolves the chosen button's value, or null for
 * Escape / clicking outside, which always means "cancel".
 */

export interface DialogButton {
  label: string;
  value: string;
  /** Focused first; Enter picks it. */
  primary?: boolean;
  danger?: boolean;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** Short list under the message, e.g. the names of files with unsaved changes. */
  items?: string[];
  buttons: DialogButton[];
}

export const dlg: DialogOptions & { open: boolean; focusReq: number } = $state({
  open: false, title: '', message: '', items: [], buttons: [], focusReq: 0,
});

let resolver: ((v: string | null) => void) | null = null;

export function showDialog(opts: DialogOptions): Promise<string | null> {
  resolver?.(null); // a newer question replaces one still open
  Object.assign(dlg, { message: '', items: [], ...opts, open: true });
  dlg.focusReq++;
  return new Promise((resolve) => { resolver = resolve; });
}

export function closeDialog(value: string | null): void {
  if (!dlg.open) return;
  const done = resolver;
  resolver = null;
  dlg.open = false;
  done?.(value);
  editor.focus(); // harmless when no file is open (the editor is hidden)
}
