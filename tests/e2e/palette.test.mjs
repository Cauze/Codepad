// Command palette (fuzzy search, running commands), Go to Line, Switch Tab, tab navigation, zoom, themes, closing tabs.
import path from 'node:path';
import { suite, sleep, SRC } from './harness.mjs';

const args = [path.join(SRC, 'main.ts'), path.join(SRC, 'style.css'), path.join(SRC, 'lib', 'palette.svelte.ts')];

suite('Command palette and tabs', { args, settings: { theme: 'system' } }, async (t) => {
  const { check, ev, shot, readSettings } = t;
  const key = (k, mods = {}) => ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true,...${JSON.stringify(mods)}}))`);
  const typeIn = (text) => ev(`(()=>{const i=document.getElementById('pal-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const palKey = (k) => ev(`document.getElementById('pal-input').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true}))`);
  const runCommand = async (query) => { await key('P', { ctrlKey: true, shiftKey: true }); await typeIn(query); await palKey('Enter'); await sleep(300); };
  const status = () => ev(`document.getElementById('st-pos').textContent`);
  const activeName = () => ev(`document.querySelector('.tab.active .name').textContent`);

  check('three tabs opened from CLI args', (await t.tabNames()).length === 3, JSON.stringify(await t.tabNames()));

  // --- palette contents
  await key('P', { ctrlKey: true, shiftKey: true });
  const titles = await ev(`[...document.querySelectorAll('#pal-list li .pt')].map(e=>e.textContent)`);
  check('palette lists commands', titles.includes('Go to Line…') && titles.includes('Toggle Word Wrap') && titles.includes('Close All Files'), titles.length + ' commands');
  check('"Reset Zoom" hidden at default zoom', !titles.includes('Reset Zoom'));
  check('current theme hidden from list', !titles.includes('Theme: System'));
  await shot('palette');
  await palKey('Escape');
  check('Escape closes palette', await ev(`document.getElementById('palette').hidden`));

  // --- fuzzy + run
  await runCommand('twrap');
  check('Toggle Word Wrap applies', await ev(`!!document.querySelector('.cm-lineWrapping')`));
  await sleep(600);
  check('word wrap persisted to settings.json', readSettings().wordWrap === true);
  await runCommand('twrap');
  check('toggling back removes wrap', !(await ev(`!!document.querySelector('.cm-lineWrapping')`)));

  await key('P', { ctrlKey: true, shiftKey: true }); await typeIn('tline');
  check('"tline" ranks Toggle Line Numbers first', (await ev(`document.querySelector('#pal-list li .pt').textContent`)) === 'Toggle Line Numbers');
  check('matched letters are highlighted', (await ev(`[...document.querySelectorAll('#pal-list li.sel .pt b')].map(b=>b.textContent).join('').toLowerCase()`)) === 'tline');
  await palKey('Enter'); await sleep(300);
  check('Toggle Line Numbers hides gutter', !(await ev(`!!document.querySelector('.cm-lineNumbers')`)));
  await runCommand('line numbers');
  check('Toggle Line Numbers shows gutter', await ev(`!!document.querySelector('.cm-lineNumbers')`));

  // --- go to line
  await key('g', { ctrlKey: true });
  const hint = await ev(`document.querySelector('#pal-list li').textContent`);
  check('Go to Line prompt shows hint', /lines/.test(hint), hint);
  await typeIn('abc'); await palKey('Enter');
  check('invalid input keeps prompt open', !(await ev(`document.getElementById('palette').hidden`)));
  await typeIn('60:5'); await palKey('Enter'); await sleep(300);
  check('Go to Line 60:5 moves cursor', (await status()) === 'Ln 60, Col 5', await status());
  check('palette closed after go-to', await ev(`document.getElementById('palette').hidden`));

  // --- switch tab
  await key('p', { ctrlKey: true });
  const names = await ev(`[...document.querySelectorAll('#pal-list li .pt')].map(e=>e.textContent)`);
  check('Switch Tab lists open files', names.length === 3, names.join(', '));
  await typeIn('palette'); await palKey('Enter'); await sleep(300);
  check('Switch Tab activates palette.svelte.ts', (await activeName()).startsWith('palette.svelte.ts'));

  // --- tab navigation
  await key('Tab', { ctrlKey: true }); await sleep(100);
  check('Ctrl+Tab goes to next tab (wraps)', (await activeName()).startsWith('main.ts'));
  await key('Tab', { ctrlKey: true, shiftKey: true }); await sleep(100);
  check('Ctrl+Shift+Tab goes back', (await activeName()).startsWith('palette.svelte.ts'));

  // --- zoom
  await key('=', { ctrlKey: true }); await sleep(500);
  check('Zoom In -> fontSize 14.5', readSettings().fontSize === 14.5, String(readSettings().fontSize));
  await runCommand('reset zoom');
  await sleep(500);
  check('Reset Zoom -> 13.5', readSettings().fontSize === 13.5);

  // --- theme
  await runCommand('theme: light');
  check('Theme: Light applied', (await ev(`document.documentElement.dataset.theme`)) === 'light');
  await sleep(500);
  await shot('light');
  check('theme persisted', readSettings().theme === 'light');
  await runCommand('theme: dark');
  check('Theme: Dark applied', (await ev(`document.documentElement.dataset.theme`)) === 'dark');

  // --- close button, with a real mouse click (the earlier bug)
  const rect = JSON.parse(await ev(`(()=>{const r=document.querySelector('.tab.active .x').getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`));
  await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(300);
  check('clicking the x closes the tab', (await t.tabNames()).length === 2, JSON.stringify(await t.tabNames()));

  // --- close others / all
  await runCommand('close others');
  check('Close Other Tabs leaves 1', (await t.tabNames()).length === 1);
  await runCommand('close all');
  check('Close All Files leaves 0', (await t.tabNames()).length === 0);
  check('empty state shown', await ev(`document.getElementById('empty').classList.contains('show')`));
});
