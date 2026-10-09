// `codepad file` from a terminal: "Add codepad to PATH" in the palette, the launchers, warm and cold starts, removal.
// Edits the user's PATH, so it skips itself if "codepad" is already on it (that's yours, not ours).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { suite, sleep, f, DIR } from './harness.mjs';

const BIN = path.join(process.env.LOCALAPPDATA ?? '', 'Codepad', 'bin');
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const userPath = () => execSync(`powershell -NoProfile -Command "[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','User'))"`).toString().trim();
const onPath = () => userPath().toLowerCase().includes(BIN.toLowerCase());
const withUserPath = (env) => ({ ...env, PATH: userPath() + ';' + process.env.PATH });
const runCodepad = (cmd, shell = 'cmd') => execSync(
  shell === 'cmd' ? `cmd /c "cd /d ${DIR} && codepad ${cmd}"` : `"${GIT_BASH}" -c "cd '${DIR.replaceAll('\\', '/')}' && codepad ${cmd}"`,
  { env: withUserPath(process.env), timeout: 15000 });

suite('codepad on the PATH', { files: { 'first.txt': 'one', 'second.txt': 'two' } }, async (t) => {
  const { check } = t;
  if (onPath()) { console.log('SKIP  "codepad" is already on your PATH'); return; }
  try {
    let rows = await t.palette('Command Line');
    check('off: palette offers only "Add"', rows.length === 1 && /Add "codepad" to PATH/.test(rows[0]), JSON.stringify(rows));
    await t.palette('Command Line', true);
    check('Add puts the launcher folder on the user PATH', onPath());
    check('...with both launchers', fs.existsSync(path.join(BIN, 'codepad.cmd')) && fs.existsSync(path.join(BIN, 'codepad')));
    check('...and shows a toast', (await t.notes()).some((n) => /Added "codepad"/.test(n)), JSON.stringify(await t.notes()));
    rows = await t.palette('Command Line');
    check('on: palette offers only "Remove"', rows.length === 1 && /Remove "codepad"/.test(rows[0]), JSON.stringify(rows));

    // a second launch while Codepad is running: a relative file name, resolved against the terminal's folder
    const t0 = Date.now();
    runCodepad('first.txt');
    check('cmd: "codepad first.txt" returns right away (not waiting for the app)', Date.now() - t0 < 5000, `${Date.now() - t0}ms`);
    await sleep(1500);
    check('...and opens it in the running window', (await t.tabNames()).includes('first.txt'), JSON.stringify(await t.tabNames()));
    if (fs.existsSync(GIT_BASH)) {
      runCodepad('second.txt', 'sh'); await sleep(1500);
      check('Git Bash: "codepad second.txt" works too', (await t.tabNames()).includes('second.txt'), JSON.stringify(await t.tabNames()));
    } else console.log('SKIP  Git Bash check (not installed)');

    // a cold start through the command
    await t.restart({ via: (env) => spawn('cmd', ['/c', `cd /d ${DIR} && codepad first.txt`], { env: withUserPath(env), stdio: 'ignore' }) });
    check('cold start: "codepad first.txt" opens the file', (await t.tabNames()).includes('first.txt'), JSON.stringify(await t.tabNames()));

    // the on/off state is read from the system, so it survives a restart; then take it off again
    await t.restart({});
    rows = await t.palette('Command Line');
    check('after restart the palette still knows it is on', rows.length === 1 && /Remove/.test(rows[0]), JSON.stringify(rows));
    await t.palette('Command Line', true);
    check('Remove takes it off the PATH', !onPath());
    check('...and deletes the launchers', !fs.existsSync(path.join(BIN, 'codepad.cmd')) && !fs.existsSync(path.join(BIN, 'codepad')));
  } finally {
    if (onPath()) execSync(`"${t.EXE}" --unregister-path`);
  }
});
