// Ctrl+Shift+F: hits grouped by file, toggles, binary files skipped, jumping to a hit.
import fs from 'node:fs';
import { suite, sleep, CTRL, SHIFT, f } from './harness.mjs';

fs.writeFileSync(f('one.txt'), 'alpha beta\nGamma delta\nbeta again, Beta\n');
fs.writeFileSync(f('two.js'), 'const beta = 1;\nlet betamax = 2;\n\n// nothing\n');
fs.writeFileSync(f('bin.dat'), Buffer.from([0x62, 0x65, 0x74, 0x61, 0x00, 0x01]));
fs.writeFileSync(f('three.txt'), 'no match here\n');

suite("Search across open tabs", { args: ['one.txt', 'two.js', 'bin.dat', 'three.txt'], settings: { theme: 'dark', checkForUpdates: false, startup: 'empty', editable: true } }, async (t) => {
  const { check, send, ev, key, palette } = t;
  const open = () => key('F', 'KeyF', 70, CTRL | SHIFT);
  const isOpen = () => ev(`!document.getElementById('tsearch').hidden`);
  const setQuery = async (q) => { await ev(`(()=>{const i=document.getElementById('ts-input');i.focus();i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(400); };
  const summary = () => ev(`document.getElementById('ts-summary').textContent`);
  const hits = () => ev(`[...document.querySelectorAll('#ts-list .hit')].map(h=>h.querySelector('.ln').textContent+':'+h.querySelector('.txt').textContent)`);
  const groups = () => ev(`[...document.querySelectorAll('#ts-list .gname')].map(g=>g.textContent)`);
  const activeTab = () => ev(`document.querySelector('.tab.active .name').textContent.trim()`);
  const sel = () => ev(`(()=>{const s=getSelection();return s.toString()})()`);
  const goTab = async (name) => { await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim().startsWith(${JSON.stringify(name)}));t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));})()`); await sleep(300); };

  await sleep(2500);
  await goTab('three.txt');
  check('overlay closed initially', !(await isOpen()));
  await open(); await sleep(200);
  check('Ctrl+Shift+F opens the search overlay', await isOpen());
  check('input is focused', await ev(`document.activeElement.id`) === 'ts-input');

  await setQuery('beta');
  check('case-insensitive by default; groups only files with hits', JSON.stringify(await groups()) === '["one.txt","two.js"]', JSON.stringify(await groups()));
  const h = await hits();
  check('finds every match, one row each, with line numbers', h.length === 5 && h[0].startsWith('1:alpha beta') && h.some((x) => x.startsWith('3:beta again')), JSON.stringify(h));
  check('summary counts results and files', /^5 results in 2 files$/.test(await summary()), await summary());
  check('binary files are not searched', !(await groups()).includes('bin.dat'));
  check('the match is highlighted', (await ev(`document.querySelector('#ts-list mark').textContent`)).toLowerCase() === 'beta');

  await ev(`document.querySelectorAll('.ts-opt')[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  check('Match case narrows results', (await hits()).length === 4 || (await hits()).length === 3, (await summary()));
  await ev(`document.querySelectorAll('.ts-opt')[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);
  await ev(`document.querySelectorAll('.ts-opt')[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  check('Whole word excludes "betamax"', (await hits()).every((x) => !x.includes('betamax')) && (await hits()).length === 4, JSON.stringify(await hits()));
  await ev(`document.querySelectorAll('.ts-opt')[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);

  await ev(`document.querySelectorAll('.ts-opt')[2].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);
  await setQuery('^(alpha|let) \\w+');
  check('Regex mode works', (await hits()).length === 2, JSON.stringify(await hits()));
  await setQuery('(unclosed');
  check('invalid regex shows an error, not a crash', /\S/.test(await summary()) && (await hits()).length === 0 && await ev(`document.getElementById('ts-summary').classList.contains('err')`), await summary());
  await ev(`document.querySelectorAll('.ts-opt')[2].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);

  await setQuery('no such thing');
  check('no results message', (await summary()) === 'No results');

  // ---- navigate
  await setQuery('beta');
  await key('ArrowDown', 'ArrowDown', 40); await key('ArrowDown', 'ArrowDown', 40);
  check('arrow keys move the selection', await ev(`[...document.querySelectorAll('#ts-list .hit')].findIndex(h=>h.classList.contains('sel'))`) === 2);
  await key('Enter', 'Enter', 13); await sleep(400);
  check('Enter closes the overlay', !(await isOpen()));
  check('...and activates the tab of that hit', (await activeTab()) === 'one.txt', await activeTab());
  check('...with the match selected in the editor', (await sel()).toLowerCase() === 'beta', JSON.stringify(await sel()));

  // jump into a different tab by clicking
  await open(); await sleep(200);
  check('selected text seeds the query', await ev(`document.getElementById('ts-input').value`) === 'beta' || (await ev(`document.getElementById('ts-input').value`)).toLowerCase() === 'beta');
  await setQuery('betamax');
  await ev(`document.querySelector('#ts-list .hit').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(400);
  check('clicking a result opens its tab', (await activeTab()) === 'two.js' && (await sel()) === 'betamax', `${await activeTab()} / ${await sel()}`);

  // unsaved edits are searched
  await ev(`document.querySelector('.cm-content').focus()`);
  await key('Home', 'Home', 36, CTRL);
  await send('Input.insertText', { text: 'zzzunsaved ' }); await sleep(200);
  await open(); await sleep(200);
  await setQuery('zzzunsaved');
  check('unsaved edits are included in the search', (await hits()).length === 1 && (await groups())[0] === 'two.js', JSON.stringify(await hits()));

  await key('Escape', 'Escape', 27); await sleep(200);
  check('Escape closes it', !(await isOpen()));
  check('palette lists the command', await (async () => {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
    await ev(`(()=>{const i=document.getElementById('pal-input');i.value='Search in Open';i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
    const rows = await ev(`[...document.querySelectorAll('#pal-list li .pt')].map(l=>l.textContent)`);
    await key('Escape', 'Escape', 27);
    return rows.includes('Search in Open Files…');
  })());
});
