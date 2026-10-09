// Toasts: restoring a session with a missing file stays silent, opening a missing recent file shows an error toast.
import { suite, sleep, f } from './harness.mjs';

const ghost = f('ghost.txt');

suite('Toasts for failed opens', {
  files: { 'ok.txt': 'hello' },
  args: ['ok.txt'],
  settings: { startup: 'restore' },
  state: { session: { paths: [ghost + '2'], active: null }, recent: [ghost, f('ok.txt')] },
}, async (t) => {
  const { check, ev } = t;
  check('session restore of a missing file is silent', (await ev(`document.querySelectorAll('.note').length`)) === 0);

  // the recent list is only shown with no tabs open, so close the open one first
  await ev(`document.querySelector('.tab .x, .tab button')?.click()`); await sleep(500);
  check('recent list shows both entries', (await ev(`document.querySelectorAll('#recent li').length`)) === 2);
  await ev(`[...document.querySelectorAll('#recent li button')].find(b=>b.textContent.includes('ghost')).click()`); await sleep(800);
  const notes = await t.notes();
  check('failed open shows an error toast naming the file', notes.length === 1 && /Couldn't open ghost.txt/.test(notes[0]), JSON.stringify(notes));
  check('toast has error styling', await ev(`!!document.querySelector('.note.err')`));
  check('missing file pruned from recent list', (await ev(`document.querySelectorAll('#recent li').length`)) === 1);
  await ev(`document.querySelector('.note button').click()`); await sleep(200);
  check('toast can be dismissed', (await ev(`document.querySelectorAll('.note').length`)) === 0);
});
