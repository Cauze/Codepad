// Code/Split/Preview views, rendering, sanitising, links, scroll sync, markdownDefaultView.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { suite, sleep, CTRL, SHIFT, f, EXE } from './harness.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(f('img'));
fs.writeFileSync(f('img/dot.png'), PNG);
let long = '---\ntitle: Demo\ntags: [a, b]\n---\n\n# Title Here\n\nIntro paragraph with **bold**, *italic*, `code` and a [link](https://example.com/page).\n\n';
long += '## Section One\n\n- [x] done item\n- [ ] open item\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst answer = 42;\nfunction hi() { return "x"; }\n```\n\n![dot](img/dot.png)\n\n[Other doc](other.md) and [jump](#section-two)\n\n';
long += '<script>window.__pwned = 1</script>\n<img src="x" onerror="window.__pwned = 2">\n\n<details><summary>More</summary>hidden text</details>\n\n';
for (let i = 0; i < 80; i++) long += `Paragraph ${i} lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n`;
long += '## Section Two\n\nThe end.\n';
fs.writeFileSync(f('doc.md'), long);
fs.writeFileSync(f('other.md'), '# Other\n\nhello\n');
fs.writeFileSync(f('plain.txt'), 'not markdown\n');

suite("Markdown preview", { args: ['plain.txt', 'doc.md'], settings: { theme: 'dark', checkForUpdates: false, startup: 'empty', editable: true } }, async (t) => {
  const { check, send, ev, shot, key, setSettings } = t;
  const goTab = async (name) => { await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim().startsWith(${JSON.stringify(name)}));t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));})()`); await sleep(600); };
  const md = () => ev(`!!document.getElementById('md')`);
  const mdText = () => ev(`document.getElementById('md')?.innerText ?? ''`);
  const editorVisible = () => ev(`getComputedStyle(document.getElementById('editor')).visibility`);
  const seg = () => ev(`[...document.querySelectorAll('#st-md button')].map(b=>b.textContent+(b.classList.contains('on')?'*':''))`);
  const clickSeg = async (label) => { await ev(`[...document.querySelectorAll('#st-md button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(900); };
  const topLineNum = () => ev(`(()=>{const sd=document.querySelector('.cm-scroller');const r=sd.getBoundingClientRect();const el=document.elementFromPoint(r.left+120,r.top+4);const l=el?.closest('.cm-line');const lines=[...document.querySelectorAll('.cm-line')];return lines.indexOf(l)})()`);

  await sleep(2500);
  await goTab('plain.txt');
  check('no Markdown controls on a .txt file', (await seg()).length === 0 && !(await md()));
  await goTab('doc.md');
  check('Markdown controls appear on a .md file, Code is selected by default', JSON.stringify(await seg()) === '["Code*","Split","Preview"]', JSON.stringify(await seg()));
  check('no preview pane in Code view', !(await md()));

  // ---- preview only (Ctrl+Shift+V)
  await key('V', 'KeyV', 86, CTRL | SHIFT); await sleep(900);
  check('Ctrl+Shift+V shows the preview', await md());
  check('...and hides the editor', (await editorVisible()) === 'hidden');
  check('segmented control follows', JSON.stringify(await seg()) === '["Code","Split","Preview*"]');
  const txt = await mdText();
  check('heading rendered', await ev(`document.querySelector('#md h1')?.textContent`) === 'Title Here');
  check('front matter is not rendered as markup', !(await ev(`!!document.querySelector('#md hr')`)) && /title: Demo/.test(txt));
  check('bold / inline code / link rendered', await ev(`!!document.querySelector('#md strong') && !!document.querySelector('#md p code') && !!document.querySelector('#md a[href="https://example.com/page"]')`));
  check('table rendered', await ev(`document.querySelectorAll('#md table td').length`) === 2);
  check('task list rendered', await ev(`document.querySelectorAll('#md input[type=checkbox]').length`) === 2 && await ev(`document.querySelector('#md input[type=checkbox]').checked`));
  check('heading ids exist for anchors', await ev(`!!document.getElementById('section-two')`));
  check('code block syntax-highlighted', await ev(`document.querySelectorAll('#md pre code span').length`) > 3, await ev(`document.querySelector('#md pre code')?.innerHTML.slice(0, 120)`));
  check('relative image is loaded (data URL)', await ev(`document.querySelector('#md img[alt=dot]')?.src.startsWith('data:image/png') && document.querySelector('#md img[alt=dot]').naturalWidth === 1`));
  check('<script> is removed', (await ev(`window.__pwned`)) === undefined && !(await ev(`!!document.querySelector('#md script')`)));
  check('onerror handler is removed', !(await ev(`!!document.querySelector('#md img[onerror]')`)));
  check('<details> survives', await ev(`!!document.querySelector('#md details summary')`));
  await shot('md-preview');

  // ---- links
  const pd = await ev(`(()=>{const m=document.querySelector('#md a[href^="https"]');const ev=new MouseEvent('click',{bubbles:true,cancelable:true});m.addEventListener('click',()=>{},{once:true});m.dispatchEvent(ev);return ev.defaultPrevented})()`); await sleep(300);
  check('external link click is intercepted (never navigates the webview)', pd === true);
  const loc = await ev('location.href');
  check('...and the app page is still the app', !/example.com/.test(loc), loc);
  await ev(`document.querySelector('#md a[href="#section-two"]').click()`); await sleep(300);
  check('#anchor scrolls inside the preview', await ev(`document.getElementById('md').scrollTop`) > 500);
  await ev(`document.querySelector('#md a[href="other.md"]').click()`); await sleep(900);
  check('relative .md link opens that file in a tab', await ev(`[...document.querySelectorAll('.tab .name')].some(n=>n.textContent.trim()==='other.md')`));
  await goTab('doc.md');

  // ---- split view + sync
  await clickSeg('Split');
  check('Split shows editor and preview together', (await md()) && (await editorVisible()) === 'visible');
  const widths = await ev(`[document.getElementById('editor').getBoundingClientRect().width, document.getElementById('md').getBoundingClientRect().width]`);
  check('...in two similar halves', Math.abs(widths[0] - widths[1]) < 40, JSON.stringify(widths));
  await shot('md-split');
  await ev(`document.getElementById('md').scrollTop = 0`); await sleep(400);
  const ed0 = await ev(`document.querySelector('.cm-scroller').scrollTop`);
  await ev(`document.getElementById('md').scrollTop = 1500`); await sleep(500);
  const ed1 = await ev(`document.querySelector('.cm-scroller').scrollTop`);
  check('scrolling the preview scrolls the editor along', ed1 > ed0 + 300, `${ed0} -> ${ed1}`);
  await ev(`document.querySelector('.cm-scroller').scrollTop = 0`); await sleep(500);
  check('scrolling the editor back scrolls the preview back', await ev(`document.getElementById('md').scrollTop`) < 200, await ev(`document.getElementById('md').scrollTop`));
  // live update
  await ev(`document.querySelector('.cm-content').focus()`);
  await key('Home', 'Home', 36, CTRL);
  await send('Input.insertText', { text: '# ' });
  await sleep(700);
  check('typing updates the preview live', (await ev(`document.querySelector('#md h1')?.textContent`)) !== 'Title Here' && (await ev(`document.querySelector('#md')?.innerText`)).includes('title: Demo'));
  await key('z', 'KeyZ', 90, CTRL); await sleep(600);

  // ---- back to code, position carried
  await clickSeg('Preview');
  await ev(`document.getElementById('md').scrollTop = 2400`); await sleep(400);
  await clickSeg('Code');
  check('Code view again: preview gone, editor back', !(await md()) && (await editorVisible()) === 'visible');
  check('editor is where the preview was reading', await ev(`document.querySelector('.cm-scroller').scrollTop`) > 800, await ev(`document.querySelector('.cm-scroller').scrollTop`));

  // ---- settings default
  await setSettings({ editable: true, markdownDefaultView: 'split' });
  await ev(`[...document.querySelectorAll('.tab .x')].find((x, i) => document.querySelectorAll('.tab .name')[i].textContent.trim()==='other.md').click()`); await sleep(400);
  await ev(`[...document.querySelectorAll('.tab .x')].find((x, i) => document.querySelectorAll('.tab .name')[i].textContent.trim()==='doc.md').click()`); await sleep(500);
  spawn(EXE, [f('other.md')], { env: process.env, stdio: 'ignore' }); await sleep(1800);
  check('markdownDefaultView: split makes newly opened .md files open split', (await md()) && JSON.stringify(await seg()) === '["Code","Split*","Preview"]', JSON.stringify(await seg()));

  // ---- light theme screenshot
  await setSettings({ editable: true, theme: 'light', markdownDefaultView: 'preview' });
  await ev(`[...document.querySelectorAll('#st-md button')].find(b=>b.textContent==='Preview').click()`); await sleep(800);
  await shot('md-light');
});
