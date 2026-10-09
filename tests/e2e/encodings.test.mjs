// Detecting encodings, the status-bar menus, reopening/saving with another encoding, LF/CRLF toggle.
import fs from 'node:fs';
import { suite, sleep, CTRL, f } from './harness.mjs';

const u16 = (s, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')]);
fs.writeFileSync(f('u16.txt'), u16('héllo\r\n€x\r\n'));
fs.writeFileSync(f('latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
fs.writeFileSync(f('bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom file\n')]));
fs.writeFileSync(f('cyr.txt'), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]));
fs.writeFileSync(f('naive.txt'), 'naïve\n');
fs.writeFileSync(f('snow.txt'), 'snow ☃\n');
fs.writeFileSync(f('lf.txt'), 'one\ntwo\n');

suite("Encodings and line endings", { args: ['u16.txt', 'latin.txt', 'bom.txt', 'cyr.txt', 'naive.txt', 'snow.txt', 'lf.txt'], settings: { theme: 'dark', checkForUpdates: false, startup: 'empty', editable: true } }, async (t) => {
  const { check, send, ev, key, setSettings, palette } = t;
  const goTab = async (name) => { await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim().startsWith(${JSON.stringify(name)}));t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));t.click();})()`); await sleep(300); };
  const isDirty = () => ev(`document.querySelector('.tab.active')?.classList.contains('dirty')`);
  const docText = () => ev(`document.querySelector('.cm-content').innerText`);
  const enc = () => ev(`document.getElementById('st-enc')?.textContent ?? null`);
  const eol = () => ev(`document.getElementById('st-eol')?.textContent ?? null`);
  const dialog = () => ev(`(()=>{const d=document.getElementById('dialog');if(!d||d.hidden)return null;return {title:d.querySelector('h2').textContent,message:d.querySelector('p')?.textContent??''}})()`);
  const clickDlg = async (label) => { await ev(`[...document.querySelectorAll('#dialog button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(350); };
  const typeInPalette = async (q) => {
    await ev(`(()=>{const i=document.getElementById('pal-input');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
    await key('Enter', 'Enter', 13); await sleep(250);
  };
  const runCmd = async (title) => {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
    await typeInPalette(title);
  };
  const insertAtTop = async (t) => { await ev(`document.querySelector('.cm-content').focus()`); await key('Home', 'Home', 36, CTRL); await send('Input.insertText', { text: t }); await sleep(150); };
  const save = async () => { await key('s', 'KeyS', 83, CTRL); await sleep(500); };
  const rd = (n) => fs.readFileSync(f(n));

  await sleep(2500);

  // ---- detection
  await goTab('u16.txt');
  check('UTF-16 LE (BOM) is detected', (await enc()) === 'UTF-16 LE', await enc());
  check('UTF-16 text is decoded', (await docText()).includes('héllo') && (await docText()).includes('€x'));
  check('UTF-16 CRLF is detected', (await eol()) === 'CRLF', await eol());
  await insertAtTop('Z');
  await save();
  check('UTF-16 file is written back as UTF-16 LE with BOM', rd('u16.txt').equals(u16('Zhéllo\r\n€x\r\n')), rd('u16.txt').toString('hex').slice(0, 40));

  await goTab('latin.txt');
  check('invalid UTF-8 falls back to Windows 1252', (await enc()) === 'Western (Windows 1252)', await enc());
  check('Windows 1252 text decoded (é)', (await docText()).includes('café'));
  check('legacy-encoded file is editable', (await ev(`document.getElementById('st-ro')?.textContent ?? null`)) === null);
  await insertAtTop('x');
  await save();
  check('Windows 1252 file written back byte-for-byte', rd('latin.txt').equals(Buffer.from([0x78, 0x63, 0x61, 0x66, 0xe9, 0x0a])), rd('latin.txt').toString('hex'));

  await goTab('bom.txt');
  check('UTF-8 BOM shown', (await enc()) === 'UTF-8 with BOM', await enc());
  await goTab('naive.txt');
  check('plain UTF-8 shown', (await enc()) === 'UTF-8', await enc());

  // ---- reopen with encoding
  await goTab('cyr.txt');
  check('cp1251 file is guessed as Windows 1252 (mojibake)', (await enc()) === 'Western (Windows 1252)' && (await docText()).includes('Ïðèâåò'));
  await runCmd('Reopen with Encoding');
  await typeInPalette('Cyrillic (Windows 1251)');
  check('Reopen with Encoding re-decodes the file', (await docText()).includes('Привет'), await docText());
  check('encoding label updated', (await enc()) === 'Cyrillic (Windows 1251)', await enc());
  check('reopening does not dirty the tab', !(await isDirty()));

  // ---- save with encoding
  await goTab('naive.txt');
  await runCmd('Save with Encoding');
  await typeInPalette('Western (Windows 1252)');
  check('Save with Encoding rewrites the file in that encoding', rd('naive.txt').equals(Buffer.from([0x6e, 0x61, 0xef, 0x76, 0x65, 0x0a])), rd('naive.txt').toString('hex'));
  check('...and the tab is clean afterwards', !(await isDirty()) && (await enc()) === 'Western (Windows 1252)');

  // ---- unmappable
  await goTab('snow.txt');
  await runCmd('Save with Encoding');
  await typeInPalette('Western (Windows 1252)');
  const dlg = await dialog();
  check('unmappable character is reported, naming it', dlg && /Couldn't save/.test(dlg.title) && dlg.message.includes('☃'), JSON.stringify(dlg));
  await clickDlg('OK');
  check('...file is untouched', rd('snow.txt').toString('utf8') === 'snow ☃\n');
  check('...and the tab keeps its old encoding and is clean', (await enc()) === 'UTF-8' && !(await isDirty()));

  // ---- forced decode that fails => read-only
  await goTab('latin.txt');
  await runCmd('Reopen with Encoding');
  await typeInPalette('UTF-8');
  check('forcing UTF-8 on a non-UTF-8 file makes it read-only', (await ev(`document.getElementById('st-ro')?.textContent ?? null`)) === 'Read-only');

  // ---- line endings
  await goTab('lf.txt');
  check('LF detected', (await eol()) === 'LF');
  await ev(`document.getElementById('st-eol').click()`); await sleep(200);
  check('clicking the LF button switches to CRLF and dirties the tab', (await eol()) === 'CRLF' && (await isDirty()));
  await save();
  check('CRLF written to disk', rd('lf.txt').toString() === 'one\r\ntwo\r\n', JSON.stringify(rd('lf.txt').toString()));
  check('tab clean after save', !(await isDirty()));
  await runCmd('Line Endings: LF');
  check('palette command switches back to LF', (await eol()) === 'LF' && (await isDirty()));
  await ev(`document.getElementById('st-eol').click()`); await sleep(200);
  check('returning to the saved line ending clears the dirty flag', (await eol()) === 'CRLF' && !(await isDirty()));

  // ---- editing off
  await setSettings({ editable: false });
  await goTab('naive.txt');
  check('line-ending button is disabled when editing is off', await ev(`document.getElementById('st-eol').disabled`) === true);
});
