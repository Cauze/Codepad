// What is specific to the Mac: window and title bar, Cmd/Option shortcuts, shortcut labels, the menu bar's
// commands, files handed over by Finder (running and cold start), and the `codepad` command.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { suite, sleep, f, IS_MAC, BUNDLE, EXE, DIR } from './harness.mjs';

if (!IS_MAC) { console.log('SKIP  these checks are for macOS'); process.exit(0); }

fs.writeFileSync(f('first.txt'), 'first file\n');
fs.writeFileSync(f('second.txt'), 'second file\n');
fs.writeFileSync(f('third.txt'), 'third file\n');
fs.writeFileSync(f('wrap.txt'), 'x'.repeat(400) + '\n');
fs.mkdirSync(f('bin1'));
const BIN = f('bin1'), BIN_LATER = f('later/bin');
const launcher = path.join(BIN, 'codepad');

suite('macOS', {
  files: {},
  args: ['first.txt', 'second.txt'],
  settings: { editable: true },
  env: () => ({ CODEPAD_BIN_DIRS: `${BIN}:${BIN_LATER}` }),
}, async (t) => {
  const { check, ev, evRaw, key, sleep: _s } = t;
  const names = () => t.tabNames();
  const active = () => ev(`document.querySelector('.tab.active .name')?.textContent.trim()`);
  const keyEvent = (init, target = 'window') => evRaw(`${target}.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,${init}}))`);
  const menu = async (id) => { await evRaw(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'menu',payload:${JSON.stringify(id)}})`); await sleep(500); };
  const caps = async (title) => ev(`(()=>{const li=[...document.querySelectorAll('#pal-list li')].find(l=>l.querySelector('.pt')?.textContent===${JSON.stringify(title)});return li?[...li.querySelectorAll('.pk kbd')].map(k=>k.textContent):null})()`);

  // ---- window
  check('the page knows it is on a Mac', (await ev(`document.documentElement.dataset.platform`)) === 'mac');
  check('no Windows-style minimize / maximize / close buttons', !(await ev(`!!document.getElementById('winctl')`)));
  const firstTabX = await ev(`document.querySelector('.tab').getBoundingClientRect().left`);
  check('tabs start after the traffic lights', firstTabX >= 70, String(firstTabX));
  check('the window has a title bar to drag by (spacer is a drag region)', await ev(`!!document.querySelector('.spacer[data-tauri-drag-region]')`));
  check('code uses a Mac monospace font', /SF Mono|Menlo/.test(await ev(`getComputedStyle(document.querySelector('.cm-scroller')).fontFamily`)));
  check('first two files opened from the command line', (await names()).join() === 'first.txt,second.txt', JSON.stringify(await names()));

  // ---- shortcuts: Cmd is the shortcut key, Control only switches tabs
  await keyEvent(`key:'Tab',code:'Tab',ctrlKey:true`);
  await sleep(200);
  check('Control+Tab goes to the next tab', (await active()) === 'first.txt', await active());
  await keyEvent(`key:'Tab',code:'Tab',ctrlKey:true,shiftKey:true`);
  await sleep(200);
  check('Control+Shift+Tab goes back', (await active()) === 'second.txt', await active());
  await keyEvent(`key:']',code:'BracketRight',metaKey:true,shiftKey:true`);
  await sleep(200);
  check('Cmd+Shift+] goes to the next tab', (await active()) === 'first.txt', await active());
  await keyEvent(`key:'[',code:'BracketLeft',metaKey:true,shiftKey:true`);
  await sleep(200);
  check('Cmd+Shift+[ goes back', (await active()) === 'second.txt', await active());
  await keyEvent(`key:'1',code:'Digit1',metaKey:true`);
  await sleep(200);
  check('Cmd+1 jumps to the first tab', (await active()) === 'first.txt', await active());
  await keyEvent(`key:'1',code:'Digit1',ctrlKey:true`);
  await sleep(200);
  check('Control+1 is not a shortcut here (a Mac user means Cmd)', (await active()) === 'first.txt');

  await keyEvent(`key:'n',code:'KeyN',ctrlKey:true`);
  await sleep(300);
  check('Control+N does not open a new file (it is an editing key on a Mac)', !(await names()).some((n) => n.startsWith('Untitled')), JSON.stringify(await names()));

  // Option turns letters into other characters: Option+Z is "Ω", but it is still the Alt+Z shortcut
  const wrapBefore = await ev(`!!document.querySelector('.cm-lineWrapping')`);
  await keyEvent(`key:'Ω',code:'KeyZ',altKey:true`);
  await sleep(500);
  check('Option+Z toggles word wrap even though it types "Ω"', (await ev(`!!document.querySelector('.cm-lineWrapping')`)) !== wrapBefore);
  await keyEvent(`key:'Ω',code:'KeyZ',altKey:true`);
  await sleep(500);

  await keyEvent(`key:',',code:'Comma',metaKey:true`);
  await sleep(700);
  check('Cmd+, opens the settings file', (await names()).includes('settings.json'), JSON.stringify(await names()));
  await t.goTab('first.txt');

  // ---- Option+Cmd+Option letters inside the find box (Option+C is "ç" on a Mac keyboard)
  await ev(`document.querySelector('.cm-content').focus()`);
  await key('f', 'KeyF', 70, 2);
  await sleep(300);
  const caseBefore = await ev(`document.querySelector('.find-box button')?.getAttribute('aria-pressed') ?? document.querySelector('.find-box button')?.className`);
  await keyEvent(`key:'ç',code:'KeyC',altKey:true`, `document.querySelector('.find input')`);
  await sleep(300);
  const caseAfter = await ev(`document.querySelector('.find-box button')?.getAttribute('aria-pressed') ?? document.querySelector('.find-box button')?.className`);
  check('Option+C in the find box toggles "match case" even though it types "ç"', caseBefore !== caseAfter, `${caseBefore} -> ${caseAfter}`);
  check('the find box labels its options with Mac shortcuts', /⌥C/.test(await ev(`document.querySelector('.find-box button').title`)), await ev(`document.querySelector('.find-box button').title`));
  await key('Escape', 'Escape', 27);

  // ---- shortcut labels
  let rows = await t.palette('New File');
  check('palette is searchable', rows.includes('New File'));
  await ev(`document.querySelector('.cm-content').focus()`);
  await t.send('Input.insertText', { text: 'x' }); // an unsaved edit, so that "Save All" is offered
  await sleep(200);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',metaKey:true,shiftKey:true,bubbles:true}))`); await sleep(250);
  await ev(`(()=>{const i=document.getElementById('pal-input');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(250);
  check('New File shows ⌘N', JSON.stringify(await caps('New File')) === '["⌘","N"]', JSON.stringify(await caps('New File')));
  check('Save As shows ⇧⌘S', JSON.stringify(await caps('Save As…')) === '["⇧","⌘","S"]', JSON.stringify(await caps('Save As…')));
  check('Save All shows ⌥⌘S', JSON.stringify(await caps('Save All')) === '["⌥","⌘","S"]', JSON.stringify(await caps('Save All')));
  check('Next Tab shows ⌃Tab (Control, not Cmd)', JSON.stringify(await caps('Next Tab')) === '["⌃","Tab"]', JSON.stringify(await caps('Next Tab')));
  check('Open Settings File shows ⌘,', JSON.stringify(await caps('Open Settings File')) === '["⌘",","]', JSON.stringify(await caps('Open Settings File')));
  const titles = await ev(`[...document.querySelectorAll('#pal-list li .pt')].map(e=>e.textContent)`);
  check('it says Finder, not Explorer', titles.includes('Reveal in Finder') && !titles.some((x) => /Explorer/.test(x)), JSON.stringify(titles.filter((x) => /Reveal|Explorer/.test(x))));
  check('no Explorer right-click menu commands on a Mac', !titles.some((x) => /^Explorer Menu/.test(x)));
  await key('Escape', 'Escape', 27);
  await key('z', 'KeyZ', 90, 2); // take the edit back
  await sleep(200);

  // ---- the menu bar sends commands as events
  await menu('new');
  check('menu: New File', (await active())?.startsWith('Untitled'), await active());
  await menu('close');
  check('menu: Close File closes the tab (not the window)', !(await names()).some((n) => n.startsWith('Untitled')) && (await names()).length >= 2, JSON.stringify(await names()));
  await menu('palette');
  check('menu: Command Palette opens it', await ev(`!document.getElementById('palette').hidden`));
  await menu('palette');
  check('...and again closes it', await ev(`document.getElementById('palette').hidden`));
  const fs0 = t.readSettings().fontSize;
  await menu('zoom_in'); await sleep(500);
  check('menu: Zoom In', t.readSettings().fontSize === fs0 + 1, String(t.readSettings().fontSize));
  await menu('zoom_reset'); await sleep(500);
  check('menu: Actual Size', t.readSettings().fontSize === fs0, String(t.readSettings().fontSize));
  await menu('settings');
  check('menu: Settings… opens the settings file', (await active()) === 'settings.json', await active());
  await t.goTab('first.txt');
  await menu('nonsense');
  check('an unknown menu id is ignored', (await active()) === 'first.txt');

  // ---- Finder hands files to the running app
  t.openViaFinder(f('third.txt'));
  await sleep(2000);
  check('a file opened from Finder joins the running window', (await names()).includes('third.txt'), JSON.stringify(await names()));
  t.openViaFinder(f('third.txt'), f('wrap.txt'));
  await sleep(2000);
  check('...and is never opened twice', (await names()).filter((n) => n === 'third.txt').length === 1 && (await names()).includes('wrap.txt'), JSON.stringify(await names()));

  // ---- the `codepad` command
  let cmds = await t.palette('Command Line');
  check('off: palette offers only "Add"', cmds.length === 1 && /Add "codepad" to PATH/.test(cmds[0]), JSON.stringify(cmds));
  check('nothing installed yet', !fs.existsSync(launcher));
  await t.palette('Command Line', true);
  check('Add writes an executable launcher into the first usable folder', fs.existsSync(launcher) && (fs.statSync(launcher).mode & 0o111) === 0o111);
  check('...which names this app', fs.readFileSync(launcher, 'utf8').includes(BUNDLE));
  check('...and not into the later folder', !fs.existsSync(BIN_LATER));
  check('...and shows a toast saying where', (await t.notes()).some((n) => n.includes(BIN)), JSON.stringify(await t.notes()));
  cmds = await t.palette('Command Line');
  check('on: palette offers only "Remove"', cmds.length === 1 && /Remove "codepad" from PATH/.test(cmds[0]), JSON.stringify(cmds));

  const t0 = Date.now();
  execFileSync(launcher, ['first.txt'], { cwd: DIR, timeout: 15000 });
  check('"codepad first.txt" returns right away and activates the running app', Date.now() - t0 < 5000, `${Date.now() - t0}ms`);
  fs.writeFileSync(f('late.txt'), 'late\n');
  execFileSync(launcher, ['late.txt'], { cwd: DIR, timeout: 15000 });
  await sleep(2000);
  check('a relative file name is resolved against the terminal\'s folder', (await names()).includes('late.txt'), JSON.stringify(await names()));

  // cold start through the command: `open` doesn't hand its environment on, so a stand-in `open` adds it back
  const shim = f('shim');
  fs.mkdirSync(shim);
  await t.restart({
    via: (env) => {
      fs.writeFileSync(path.join(shim, 'open'), `#!/bin/sh\nexec /usr/bin/open --env HOME=${JSON.stringify(env.HOME)} --env CODEPAD_E2E_PORT=${env.CODEPAD_E2E_PORT} --env CODEPAD_BIN_DIRS=${JSON.stringify(env.CODEPAD_BIN_DIRS)} "$@"\n`, { mode: 0o755 });
      return spawn(launcher, ['third.txt'], { cwd: DIR, env: { ...env, PATH: `${shim}:${env.PATH}` }, stdio: 'ignore' });
    },
    settings: { editable: true, startup: 'empty' },
  });
  await sleep(1500);
  check('cold start: "codepad third.txt" opens the file (Finder-style launch)', (await names()).join() === 'third.txt', JSON.stringify(await names()));

  // it is still installed after a restart, and Remove takes it away
  cmds = await t.palette('Command Line');
  check('after restart the palette still knows it is on', cmds.length === 1 && /Remove/.test(cmds[0]), JSON.stringify(cmds));
  await t.palette('Command Line', true);
  check('Remove deletes the launcher', !fs.existsSync(launcher));

  // a `codepad` that isn't ours is never touched
  fs.writeFileSync(launcher, '#!/bin/sh\necho mine\n', { mode: 0o755 });
  await t.palette('Command Line', true);
  check('Add skips a folder whose "codepad" belongs to someone else', fs.readFileSync(launcher, 'utf8') === '#!/bin/sh\necho mine\n' && fs.existsSync(path.join(BIN_LATER, 'codepad')));
  await t.palette('Command Line', true);
  check('Remove leaves someone else\'s "codepad" alone and removes ours', fs.readFileSync(launcher, 'utf8') === '#!/bin/sh\necho mine\n' && !fs.existsSync(path.join(BIN_LATER, 'codepad')));
});
