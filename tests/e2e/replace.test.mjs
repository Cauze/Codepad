// The replace row of the find widget: read-only vs editable, replace one/all, case, regex capture groups.
import fs from 'node:fs';
import path from 'node:path';
import { suite, sleep, CTRL, ALT, DIR, f } from './harness.mjs';

const file = path.join(DIR, 'r.txt');
fs.writeFileSync(file, 'foo bar foo\nfoo\nFoo\n');

suite('Find and replace', { args: ['r.txt'], settings: { editable: false }, size: [1000, 560], ready: 3000 }, async (t) => {
  const { check, send, ev, shot, key, setSettings } = t;
  const vis = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && !e.hidden && e.offsetParent!==null})()`);
  const docText = () => ev(`document.querySelector('.cm-content').innerText.replace(/\\n+/g,'\\n')`);
  const focusedPlaceholder = () => ev(`document.activeElement?.placeholder ?? null`);
  const clickBtn = async (label) => { await ev(`[...document.querySelectorAll('.find button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`); await sleep(250); };
  const closeFind = () => key('Escape', 'Escape', 27);

  await ev(`document.querySelector('.cm-content').focus()`);

  // read-only: no replace UI
  await key('f', 'KeyF', 70, CTRL);
  check('read-only: find opens', await vis('.find'));
  check('read-only: no replace toggle', !(await vis('.find-toggle')));
  await key('h', 'KeyH', 72, CTRL);
  check('read-only: Ctrl+H does not open the replace row', !(await vis('.find-row:nth-child(2)')));
  await closeFind();

  // editable
  await setSettings({ editable: true });
  await ev(`document.querySelector('.cm-content').focus()`);
  await key('f', 'KeyF', 70, CTRL);
  check('editable: replace toggle shown', await vis('.find-toggle'));
  check('editable: replace row collapsed at first', !(await vis('.find-rows .find-row:nth-child(2)')));
  await key('h', 'KeyH', 72, CTRL);
  check('Ctrl+H expands the replace row and focuses it', (await vis('.find-rows .find-row:nth-child(2)')) && (await focusedPlaceholder()) === 'Replace');
  await send('Input.insertText', { text: 'X' });
  await key('f', 'KeyF', 70, CTRL);
  check('Ctrl+F from the replace field goes back to find', (await focusedPlaceholder()) === 'Find');
  await send('Input.insertText', { text: 'foo' });
  await sleep(300);
  await shot('replace-open');
  const count = await ev(`document.querySelector('.find-count').textContent`);
  check('find counts case-insensitive matches', /of 4/.test(count), count);

  await clickBtn('Replace (Enter)');
  let txt = await docText();
  check('Replace swaps one match', txt.startsWith('X bar foo') && (txt.match(/X/g) || []).length === 1, JSON.stringify(txt));
  await clickBtn('Replace (Enter)');
  txt = await docText();
  check('Replace again moves on to the next one', txt.startsWith('X bar X'), JSON.stringify(txt));

  // Alt+C = match case, then Replace All with the keyboard
  await ev(`document.querySelector('.find-box input').focus()`);
  await key('c', 'KeyC', 67, ALT);
  await sleep(200);
  await ev(`document.querySelectorAll('.find-box input')[1].focus()`);
  await key('Enter', 'Enter', 13, CTRL | ALT);
  txt = await docText();
  check('Ctrl+Alt+Enter replaces all (case sensitive leaves "Foo")', txt.startsWith('X bar X\nX\nFoo'), JSON.stringify(txt));
  check('replacing marks the tab dirty', await ev(`document.querySelector('.tab.active').classList.contains('dirty')`));
  check('nothing written until saved', fs.readFileSync(file, 'utf8') === 'foo bar foo\nfoo\nFoo\n');

  // regex capture groups
  await ev(`document.querySelector('.find-box input').focus()`);
  await key('a', 'KeyA', 65, CTRL);
  await send('Input.insertText', { text: '(b)(a)r' });
  await key('r', 'KeyR', 82, ALT);
  await ev(`document.querySelectorAll('.find-box input')[1].focus()`);
  await key('a', 'KeyA', 65, CTRL);
  await send('Input.insertText', { text: '$2$1!' });
  await clickBtn('Replace All (Ctrl+Alt+Enter)');
  txt = await docText();
  check('regex replace supports $1 / $2', txt.startsWith('X ab! X'), JSON.stringify(txt));

  await closeFind();
  await key('z', 'KeyZ', 90, CTRL);
});
