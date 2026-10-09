// Ctrl+N, Save As (the save dialog is answered through CODEPAD_SAVE_AS), untitled tabs.
import fs from 'node:fs';
import { suite, sleep, CTRL, SHIFT, ALT, f } from './harness.mjs';

const TARGET = f('new.js');
fs.writeFileSync(f('a.txt'), 'from a\n');
fs.writeFileSync(f('b.txt'), 'from b\n');

suite('New File and Save As', { settings: { editable: false }, env: () => ({ CODEPAD_SAVE_AS: TARGET }) }, async (h) => {
  const { check, send, ev, key, setSettings } = h;
  const ctrlN = () => key('n', 'KeyN', 78, CTRL);
  const ctrlS = () => key('s', 'KeyS', 83, CTRL);
  const ctrlShiftS = () => key('S', 'KeyS', 83, CTRL | SHIFT);
  const ctrlAltS = () => key('s', 'KeyS', 83, CTRL | ALT);
  const ctrlW = () => key('w', 'KeyW', 87, CTRL);
  const tabs = () => ev(`[...document.querySelectorAll('.tab')].map(t=>({name:t.querySelector('.name').textContent.trim(),dirty:t.classList.contains('dirty'),active:t.classList.contains('active')}))`);
  const active = async () => (await tabs()).find((t) => t.active);
  const lang = () => ev(`document.getElementById('st-lang').textContent`);
  const dialog = () => ev(`(()=>{const d=document.getElementById('dialog');if(!d||d.hidden)return null;return {title:d.querySelector('h2').textContent,message:d.querySelector('p')?.textContent??''}})()`);
  const clickDlg = async (label) => { await ev(`[...document.querySelectorAll('#dialog button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(500); };
  const typeText = async (t) => { await ev(`document.querySelector('.cm-content').focus()`); await send('Input.insertText', { text: t }); await sleep(200); };
  const rd = (n) => fs.readFileSync(n, 'utf8');
  const openFile = async (p) => { h.openExternally(p); await sleep(1500); }; // single-instance forwards it
  const session = () => h.readState()?.session ?? null;
  const palette = async (q) => {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
    await ev(`(()=>{const i=document.getElementById('pal-input');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
    const rows = await ev(`[...document.querySelectorAll('#pal-list li')].map(l=>l.querySelector('.pt')?.textContent)`);
    await key('Escape', 'Escape', 27);
    return rows;
  };

  await sleep(2500);
  check('starts with no tabs', (await tabs()).length === 0);

  // ---- New File
  await ctrlN();
  let t = await active();
  check('Ctrl+N opens "Untitled-1"', t?.name === 'Untitled-1', JSON.stringify(await tabs()));
  check('...which is editable even though editing is off', (await ev(`document.getElementById('st-ro')`)) === null);
  check('...empty and clean', !t.dirty);
  check('...with LF and UTF-8 shown', (await ev(`document.getElementById('st-eol').textContent`)) === 'LF' && (await ev(`document.getElementById('st-enc').textContent`)) === 'UTF-8');
  await typeText('hello');
  check('typing marks it dirty', (await active()).dirty);
  check('no real file yet: Copy File Path / Reveal hidden', !(await palette('Copy File Path')).includes('Copy File Path') && !(await palette('Reveal')).includes('Reveal in Explorer'));
  await sleep(700);
  check('untitled tabs are not part of the saved session', JSON.stringify(session()?.paths) === '[]', JSON.stringify(session()));

  // ---- save it
  await ctrlS(); await sleep(700);
  t = await active();
  check('Ctrl+S on an untitled file saves it to the chosen path', rd(TARGET) === 'hello', fs.existsSync(TARGET) ? rd(TARGET) : 'missing');
  check('tab is renamed and clean', t?.name === 'new.js' && !t.dirty, JSON.stringify(await tabs()));
  check('language follows the new extension', (await lang()) === 'JavaScript', await lang());
  check('now it is a real file in the session', session()?.paths?.length === 1 && session().paths[0].toLowerCase() === TARGET.toLowerCase(), JSON.stringify(session()));
  check('editing stays on for a file made in Codepad', (await ev(`document.getElementById('st-ro')`)) === null);

  // ---- second untitled: numbering, close prompt
  await ctrlN();
  check('next one is Untitled-2', (await active())?.name === 'Untitled-2');
  await ctrlW(); await sleep(300);
  check('closing an empty untitled file does not prompt', (await dialog()) === null && (await tabs()).length === 1);
  await ctrlN(); await typeText('scratch'); await ctrlW(); await sleep(300);
  let dlg = await dialog();
  check('closing a non-empty untitled file asks', dlg && /Untitled-3/.test(dlg.title), JSON.stringify(dlg));
  await clickDlg("Don't Save");
  check('Don\'t Save discards it', (await tabs()).length === 1);

  // ---- Save As on an existing file
  fs.rmSync(TARGET);
  await ctrlW(); await sleep(400); // close new.js
  await openFile(f('a.txt'));
  check('a.txt opened', (await active())?.name === 'a.txt', JSON.stringify(await tabs()));
  check('palette offers Save As…', (await palette('Save As')).includes('Save As…'));
  await ctrlShiftS(); await sleep(800);
  t = await active();
  check('Ctrl+Shift+S writes the copy', fs.existsSync(TARGET) && rd(TARGET) === 'from a\n');
  check('the tab now points at the new file', t?.name === 'new.js' && !t.dirty, JSON.stringify(await tabs()));
  check('the original is untouched', rd(f('a.txt')) === 'from a\n');

  // ---- Save As onto a file open in another tab
  await openFile(f('b.txt'));
  await ctrlShiftS(); await sleep(700);
  check('Save As onto a file that is open elsewhere is refused with a toast', (await ev(`[...document.querySelectorAll('.note')].map(n=>n.textContent).join('|')`)).includes('already open'));
  check('...and b.txt keeps its name', (await active())?.name === 'b.txt');

  // ---- Save All shortcut
  await setSettings({ editable: true });
  await typeText('B>');
  await ev(`[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim()==='new.js').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`); await sleep(300);
  await typeText('N>');
  check('two dirty tabs', (await tabs()).filter((x) => x.dirty).length === 2);
  await ctrlAltS(); await sleep(800);
  check('Ctrl+Alt+S saves everything', (await tabs()).every((x) => !x.dirty) && rd(f('b.txt')).startsWith('B>') && rd(TARGET).startsWith('N>'), `${rd(f('b.txt'))}|${rd(TARGET)}`);

  // ---- default line endings
  await ctrlW(); await sleep(300); await ctrlW(); await sleep(300); fs.rmSync(TARGET, { force: true });
  await setSettings({ editable: true, defaultLineEnding: 'crlf' });
  await ctrlN();
  check('defaultLineEnding crlf is used for new files', (await ev(`document.getElementById('st-eol').textContent`)) === 'CRLF');
  await typeText('x');
  await key('Enter', 'Enter', 13);
  await typeText('y');
  await ctrlW(); await sleep(300);
  dlg = await dialog();
  if (dlg) await clickDlg('Save'); // Untitled -> Save As -> TARGET
  await sleep(800);
  check('new CRLF file is written with CRLF', fs.existsSync(TARGET) && rd(TARGET) === 'x\r\ny', JSON.stringify(fs.existsSync(TARGET) ? rd(TARGET) : null));
});
