// "Open with Codepad" in the Explorer right-click menu: added and removed from the command palette.
// Edits HKCU\Software\Classes, so it skips itself if the entry is already switched on (it's yours, not ours).
import { execSync } from 'node:child_process';
import { suite } from './harness.mjs';

const reg = (k) => { try { execSync(`reg query "${k}"`, { stdio: 'ignore' }); return true; } catch { return false; } };
const KEY = (ext) => `HKCU\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\Codepad`;

suite('Explorer menu', { files: { 'menu-test.txt': 'x' }, args: ['menu-test.txt'] }, async (t) => {
  const { check } = t;
  if (reg(KEY('txt'))) { console.log('SKIP  "Open with Codepad" is already switched on for this user'); return; }
  try {
    let rows = await t.palette('Explorer Menu');
    check('off: palette offers only "Add"', rows.length === 1 && /Add "Open with Codepad"/.test(rows[0]), JSON.stringify(rows));
    await t.palette('Explorer Menu', true);
    check('Add registers text and code files', reg(KEY('txt')) && reg(KEY('rs')) && reg(KEY('json')));
    check('...but not images or executables', !reg(KEY('png')) && !reg(KEY('exe')) && !reg(KEY('mp4')));
    check('...and shows a toast', (await t.notes()).some((n) => /added/i.test(n)), JSON.stringify(await t.notes()));
    rows = await t.palette('Explorer Menu');
    check('on: palette offers only "Remove"', rows.length === 1 && /Remove "Open with Codepad"/.test(rows[0]), JSON.stringify(rows));
    await t.palette('Explorer Menu', true);
    check('Remove clears it', !reg(KEY('txt')) && !reg(KEY('rs')));
    rows = await t.palette('Explorer Menu');
    check('off again: "Add" is back', rows.length === 1 && /Add/.test(rows[0]));
  } finally {
    execSync(`"${t.EXE}" --unregister-context-menu`);
  }
});
