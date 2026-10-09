/*
 * Small transient messages (bottom-left): "couldn't open X", auto-save failures and the like.
 * The update notice is separate; this is for everything else.
 */

export interface Note {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export const notes: Note[] = $state([]);

let next = 1;
const MAX_VISIBLE = 4;

export function dismissNote(id: number): void {
  const i = notes.findIndex((n) => n.id === id);
  if (i >= 0) notes.splice(i, 1);
}

export function notify(text: string, kind: Note['kind'] = 'info', ms = kind === 'error' ? 8000 : 4000): void {
  const dup = notes.find((n) => n.text === text); // the same message again just stays up
  if (dup) return;
  const id = next++;
  notes.push({ id, text, kind });
  if (notes.length > MAX_VISIBLE) notes.shift();
  setTimeout(() => dismissNote(id), ms);
}

export const errText = (e: unknown): string =>
  (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error').replace(/ \(os error \d+\)/, '');
