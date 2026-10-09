// Editing is off by default; with `editable` on: dirty state, save, undo-to-clean, CRLF/BOM kept, close prompts, Save All, conflicts, revert, auto save, closing the window.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { suite, sleep, CTRL, f, EXE } from './harness.mjs';

fs.writeFileSync(f('a.txt'), 'hello\nworld\n');
fs.writeFileSync(f('b.txt'), 'one\r\ntwo\r\nthree\r\n');
fs.writeFileSync(f('c.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom file\n')]));
fs.writeFileSync(f('d.txt'), Buffer.from([0x41, 0x00, 0x42, 0x0a])); // binary
fs.writeFileSync(f('e.txt'), 'eee\n');
fs.writeFileSync(f('g.txt'), 'ggg\n');
const read = (n) => fs.readFileSync(f(n));
const text = (n) => read(n).toString('utf8');

suite('Editing and saving', { args: ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'g.txt'], size: [1000, 560], ready: 3000 }, async (t) => {
  const { check, send, ev, shot, key, alive, setSettings } = t;
  const ctrlS = () => key('s', 'KeyS', 83, CTRL);
  const ctrlShiftS = () => key('s', 'KeyS', 83, CTRL | 1); // Save All is Ctrl+Alt+S now
  const ctrlZ = () => key('z', 'KeyZ', 90, CTRL);
  const ctrlW = () => key('w', 'KeyW', 87, CTRL);
  const toTop = () => key('Home', 'Home', 36, CTRL);
  const typeText = async (t) => { await ev(`document.querySelector('.cm-content').focus()`); await toTop(); await send('Input.insertText', { text: t }); await sleep(150); };
  const tabs = () => ev(`[...document.querySelectorAll('.tab')].map(t=>({name:t.querySelector('.name').textContent.trim(),dirty:t.classList.contains('dirty'),stale:t.classList.contains('stale'),active:t.classList.contains('active')}))`);
  const activeTab = async () => (await tabs()).find((t) => t.active);
  const goTab = async (name) => { await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim().startsWith(${JSON.stringify(name)}));t.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}))})()`); await sleep(250); };
  const dialog = () => ev(`(()=>{const d=document.getElementById('dialog');if(!d||d.hidden)return null;return {title:d.querySelector('h2').textContent,message:d.querySelector('p')?.textContent??'',items:[...d.querySelectorAll('li')].map(l=>l.textContent),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent),focused:document.activeElement?.textContent}})()`);
  const clickDlg = async (label) => { await ev(`[...document.querySelectorAll('#dialog button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(350); };
  const docText = () => ev(`document.querySelector('.cm-content').textContent`);
  const chip = () => ev(`document.getElementById('st-ro')?.textContent ?? null`);
  const title = () => ev(`document.title`);

  // ---- 1. viewer mode is the default and stays read-only
  await goTab('a.txt');
  check('opens read-only by default (Read-only chip)', (await chip()) === 'Read-only');
  await typeText('X');
  check('typing does nothing when editing is off', !(await activeTab()).dirty && (await docText()).startsWith('hello'));

  // ---- 2. enabling editing
  await setSettings({ editable: true });
  check('Read-only chip disappears when editing is enabled', (await chip()) === null);
  await typeText('X');
  check('typing marks the tab dirty', (await activeTab()).dirty);
  check('window title shows the unsaved dot', (await title()).startsWith('● a.txt'), await title());
  check('file on disk untouched until saved', text('a.txt') === 'hello\nworld\n');
  await shot('edit-dirty');

  // ---- 3. save
  await ctrlS(); await sleep(400);
  check('Ctrl+S writes the file', text('a.txt') === 'Xhello\nworld\n', JSON.stringify(text('a.txt')));
  check('tab is clean after saving', !(await activeTab()).dirty && !(await title()).startsWith('●'));

  // ---- 4. undo back to saved = clean
  await typeText('Y');
  check('dirty after another edit', (await activeTab()).dirty);
  await ctrlZ();
  check('undo back to the saved text clears the dirty flag', !(await activeTab()).dirty && (await docText()).startsWith('Xhello'));

  // ---- 5. CRLF and BOM survive a save
  await goTab('b.txt'); await typeText('>'); await ctrlS(); await sleep(400);
  check('CRLF line endings preserved', read('b.txt').equals(Buffer.from('>one\r\ntwo\r\nthree\r\n')), JSON.stringify(text('b.txt')));
  await goTab('c.txt'); await typeText('>'); await ctrlS(); await sleep(400);
  check('UTF-8 BOM preserved', read('c.txt').equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('>bom file\n')])), read('c.txt').toString('hex'));

  // ---- 6. a file we can't write back faithfully is not editable
  await goTab('d.txt');
  check('binary file shows Read-only even with editing on', (await chip()) === 'Read-only');
  const before = read('d.txt');
  await typeText('Z'); await ctrlS(); await sleep(300);
  check('binary file is never modified', !(await activeTab()).dirty && read('d.txt').equals(before));

  // ---- 7. command palette
  await goTab('e.txt');
  const palette = async (q) => {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
    await ev(`(()=>{const i=document.getElementById('pal-input');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
    const rows = await ev(`[...document.querySelectorAll('#pal-list li')].map(l=>l.querySelector('.pt')?.textContent)`);
    await key('Escape', 'Escape', 27);
    return rows;
  };
  check('palette hides Save when nothing is dirty', !(await palette('Save')).includes('Save'));
  await typeText('E');
  check('palette offers Save when dirty', (await palette('Save')).includes('Save'));
  check('palette offers Save All / Revert File when dirty', (await palette('Save All')).includes('Save All') && (await palette('Revert')).includes('Revert File'));

  // ---- 8. closing a dirty tab asks first
  await ctrlW(); await sleep(300);
  let d = await dialog();
  check('Ctrl+W on a dirty tab asks to save', d?.title === 'Save changes to e.txt?' && d.buttons.join('|') === 'Save|Don\'t Save|Cancel' && d.focused === 'Save', JSON.stringify(d));
  await shot('edit-dialog');
  await clickDlg('Cancel');
  check('Cancel keeps the tab and the edits', (await tabs()).some((t) => t.name === 'e.txt' && t.dirty) && text('e.txt') === 'eee\n');
  await ctrlW(); await sleep(300); await clickDlg("Don't Save");
  check("Don't Save closes without writing", !(await tabs()).some((t) => t.name === 'e.txt') && text('e.txt') === 'eee\n');

  // ---- 9. several dirty files, then Save All
  await goTab('a.txt'); await typeText('1'); await goTab('b.txt'); await typeText('2');
  check('two tabs dirty', (await tabs()).filter((t) => t.dirty).length === 2);
  await ctrlShiftS(); await sleep(500);
  check('Ctrl+Shift+S saves every dirty tab', (await tabs()).every((t) => !t.dirty) && text('a.txt').startsWith('1Xhello') && text('b.txt').startsWith('2>one'));
  await goTab('a.txt'); await typeText('3'); await goTab('b.txt'); await typeText('4');
  await ev(`document.dispatchEvent(new Event('x'))`);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
  await ev(`(()=>{const i=document.getElementById('pal-input');i.value='Close All Files';i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
  await ev(`document.getElementById('pal-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await sleep(350);
  d = await dialog();
  check('Close All with two dirty files lists them', d?.title === 'Save changes to 2 files?' && d.items.join() === 'a.txt,b.txt' && d.buttons[0] === 'Save All', JSON.stringify(d));
  await clickDlg('Save All');
  check('Save All in the dialog saves then closes everything', (await tabs()).length === 0 && text('a.txt').startsWith('31Xhello') && text('b.txt').startsWith('42>one'), JSON.stringify(await tabs()));

  // ---- 10. conflict with an external change
  for (const n of ['a.txt']) { /* reopen via a second launch (single instance) */ spawn(EXE, [f(n)], { stdio: 'ignore' }); }
  await sleep(1500);
  await typeText('M');
  fs.writeFileSync(f('a.txt'), 'changed by someone else\n');
  await sleep(2300);
  check('tab flagged when the file changes under unsaved edits', (await activeTab())?.stale === true);
  check('unsaved edits are not replaced by the external change', (await docText()).startsWith('M'));
  await ctrlS(); await sleep(350);
  d = await dialog();
  check('saving a stale file asks before overwriting', d?.title === 'a.txt changed on disk' && d.buttons.includes('Overwrite'), JSON.stringify(d));
  await shot('edit-conflict');
  await clickDlg('Cancel');
  check('Cancel leaves the other change on disk', text('a.txt') === 'changed by someone else\n');
  await ctrlS(); await sleep(350); await clickDlg('Overwrite'); await sleep(300);
  check('Overwrite writes our text and clears the flag', text('a.txt').startsWith('M31Xhello') && !(await activeTab()).dirty && !(await activeTab()).stale, JSON.stringify(text('a.txt').slice(0, 20)));

  // ---- 11. revert
  await typeText('R');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
  await ev(`(()=>{const i=document.getElementById('pal-input');i.value='Revert File';i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
  await ev(`document.getElementById('pal-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await sleep(350);
  d = await dialog();
  check('Revert File asks for confirmation', d?.title === 'Discard changes to a.txt?', JSON.stringify(d));
  await clickDlg('Discard Changes'); await sleep(300);
  check('Revert reloads from disk and clears dirty', !(await activeTab()).dirty && (await docText()).startsWith('M31Xhello'));

  // ---- 12. auto save: after delay
  await setSettings({ editable: true, autoSave: 'afterDelay', autoSaveDelay: 400 });
  await typeText('A');
  check('not saved instantly', text('a.txt').startsWith('M31'));
  await sleep(1100);
  check('afterDelay: saved shortly after typing stops', text('a.txt').startsWith('AM31Xhello') && !(await activeTab()).dirty, JSON.stringify(text('a.txt').slice(0, 12)));

  // ---- 13. auto save: on focus change
  await setSettings({ editable: true, autoSave: 'onFocusChange' });
  await typeText('B'); await sleep(900);
  check('onFocusChange: nothing written while still focused', text('a.txt').startsWith('AM31') && (await activeTab()).dirty);
  await ev(`window.dispatchEvent(new Event('blur'))`); await sleep(500);
  check('onFocusChange: window blur saves', text('a.txt').startsWith('BAM31') && !(await activeTab()).dirty);
  fs.writeFileSync(f('e.txt'), 'eee\n');
  spawn(EXE, [f('e.txt')], { stdio: 'ignore' }); await sleep(1200);
  await typeText('C'); await goTab('a.txt'); await sleep(500);
  check('onFocusChange: switching tab saves the one left', text('e.txt').startsWith('Ceee'), JSON.stringify(text('e.txt')));

  // ---- 14. auto save never prompts on close
  await setSettings({ editable: true, autoSave: 'afterDelay', autoSaveDelay: 5000 });
  await goTab('e.txt'); await typeText('D'); await ctrlW(); await sleep(500);
  check('with auto save on, closing a dirty tab saves it silently', (await dialog()) === null && text('e.txt').startsWith('DCeee') && !(await tabs()).some((t) => t.name === 'e.txt'));

  // ---- 15. turning editing off
  await setSettings({ editable: false });
  check('Read-only chip returns when editing is switched off', (await chip()) === 'Read-only');

  // ---- 16. closing the window with unsaved edits
  await setSettings({ editable: true });
  await goTab('a.txt'); await typeText('W');
  await ev(`window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })`); await sleep(600);
  d = await dialog();
  check('closing the window with unsaved edits asks first', d?.title === 'Save changes to a.txt?' && alive(), JSON.stringify(d));
  await clickDlg('Cancel'); await sleep(500);
  check('Cancel keeps the app running', alive());
  await ev(`window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })`); await sleep(500);
  await clickDlg('Save'); await sleep(1500);
  check('Save then closes the window', !alive() && text('a.txt').startsWith('WBAM31'), `alive=${alive()} ${JSON.stringify(text('a.txt').slice(0, 8))}`);
});
