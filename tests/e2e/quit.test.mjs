// Quitting from the Dock (or at log out) on a Mac must not lose unsaved edits: the app asks first, like closing the window does.
import fs from 'node:fs';
import { suite, sleep, f, IS_MAC } from './harness.mjs';

if (!IS_MAC) { console.log('SKIP  this is how macOS quits apps'); process.exit(0); }

fs.writeFileSync(f('a.txt'), 'alpha\n');

suite('Quitting from the Dock', { args: ['a.txt'], settings: { editable: true } }, async (t) => {
  const { check, ev, send } = t;
  const type = async (text) => { await ev(`document.querySelector('.cm-content').focus()`); await send('Input.insertText', { text }); await sleep(200); };
  const waitGone = async () => { for (let i = 0; i < 20 && t.alive(); i++) await sleep(250); return !t.alive(); };

  await t.terminate();
  check('with nothing unsaved the app just quits', await waitGone());

  await t.restart({ files: { 'a.txt': 'alpha\n' }, args: ['a.txt'], settings: { editable: true } });
  await type('X');
  check('typing made the tab dirty', await ev(`document.querySelector('.tab.active').classList.contains('dirty')`));
  await t.terminate();
  await sleep(800);
  check('with unsaved edits the app stays and asks', t.alive() && (await t.dialog())?.title === 'Save changes to a.txt?', JSON.stringify(await t.dialog()));
  await t.clickDlg('Cancel');
  check('Cancel keeps the app and the edits', t.alive() && (await ev(`document.querySelector('.tab.active').classList.contains('dirty')`)) && fs.readFileSync(f('a.txt'), 'utf8') === 'alpha\n');

  await t.terminate();
  await sleep(800);
  await t.clickDlg('Save');
  check('Save writes the file and then the app quits', (await waitGone()) && fs.readFileSync(f('a.txt'), 'utf8') === 'Xalpha\n', JSON.stringify(fs.readFileSync(f('a.txt'), 'utf8')));

  await t.restart({ files: { 'a.txt': 'alpha\n' }, args: ['a.txt'], settings: { editable: true } });
  await type('Y');
  await t.terminate();
  await sleep(800);
  await t.clickDlg("Don't Save");
  check("Don't Save quits and leaves the file alone", (await waitGone()) && fs.readFileSync(f('a.txt'), 'utf8') === 'alpha\n');
});
