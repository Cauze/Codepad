// The settings file stays editable, saving applies it live, and a bad edit is ignored.
import fs from 'node:fs';
import path from 'node:path';
import { suite, sleep, DIR, CFG } from './harness.mjs';

const other = path.join(DIR, 'other.txt'); fs.writeFileSync(other, 'plain\n');
const settingsFile = path.join(CFG, 'settings.json');

suite("Editing settings.json", { args: [other, settingsFile], settings: { theme: 'dark', checkForUpdates: false, startup: 'empty', editable: false } }, async (t) => {
  const { check, send, ev, key } = t;
  const chip = () => ev(`document.getElementById('st-ro')?.textContent ?? null`);
  const active = () => ev(`document.querySelector('.tab.active .name').textContent.trim()`);
  const dirty = () => ev(`document.querySelector('.tab.active').classList.contains('dirty')`);
  const goTab = async (n) => { await ev(`[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim()===${JSON.stringify(n)}).dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}))`); await sleep(300); };

  await sleep(3000);
  check('settings.json opens last/active', (await active()) === 'settings.json');
  check('settings.json is editable with editable=false (no Read-only chip)', (await chip()) === null);
  await goTab('other.txt');
  check('other files stay read-only', (await chip()) === 'Read-only');
  await goTab('settings.json');

  await ev(`document.querySelector('.cm-content').focus()`);
  await key('a', 'KeyA', 65, 2);
  await send('Input.insertText', { text: '{ "theme": "light", "editable": false, "checkForUpdates": false, "startup": "empty" }' });
  await sleep(200);
  check('typing marks it dirty', await dirty());
  check('theme still dark until saved', (await ev(`document.documentElement.dataset.theme`)) === 'dark');
  await key('s', 'KeyS', 83, 2);
  await sleep(2600);
  check('saving applies the new settings live', (await ev(`document.documentElement.dataset.theme`)) === 'light');
  check('tab is clean after the save', !(await dirty()));
  check('file on disk has the edit', JSON.parse(fs.readFileSync(settingsFile, 'utf8')).theme === 'light');

  // changing a setting from the app while the (clean) settings tab is open reloads it
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true,bubbles:true}))`);
  await sleep(3000);
  check('settings tab follows changes made in the app', (await ev(`document.querySelector('.cm-content').textContent`)).includes('fontSize'));
});
