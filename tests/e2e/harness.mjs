// Shared plumbing for the end-to-end tests.
//
// Each test file launches the real Codepad exe with WebView2's DevTools port open and drives it
// over the DevTools protocol (no OS-level input, so it never steals focus). A test is:
//
//   import { suite } from './harness.mjs';
//   suite('Name', { files: { 'a.txt': 'hello' }, args: ['a.txt'], settings: { editable: true } }, async (t) => {
//     const { check, ev, sleep } = t;
//     check('opened', (await t.tabNames()).includes('a.txt'));
//   });
//
// Safety: the tests swap in their own settings, so they back up %APPDATA%\Codepad first and put it back
// afterwards, and they refuse to start while a Codepad is already running (they would talk to it, because
// the app is single-instance). Close Codepad before running them.
//
// Which exe: $CODEPAD_EXE, else src-tauri/target/release/codepad.exe (build it with `npx tauri build --no-bundle`).

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = path.join(REPO, 'src');
const OUT = path.join(REPO, 'tests', 'e2e', '.out'); // screenshots; git-ignored
export const CFG = path.join(process.env.APPDATA ?? '', 'Codepad');
const BASE_SETTINGS = { theme: 'dark', checkForUpdates: false, startup: 'empty' };

/** A scratch folder for this test's fixture files; it is deleted when the test ends. */
export const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-e2e-'));
export const f = (n) => path.join(DIR, n);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CTRL = 2, SHIFT = 8, ALT = 1;

function findExe() {
  const exe = process.env.CODEPAD_EXE || path.join(REPO, 'src-tauri', 'target', 'release', 'codepad.exe');
  if (!fs.existsSync(exe)) {
    console.error(`Codepad exe not found: ${exe}\nBuild it with "npx tauri build --no-bundle" or set CODEPAD_EXE.`);
    process.exit(2);
  }
  return exe;
}

const running = () => /codepad\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq codepad.exe" /NH', { encoding: 'utf8' }));
/** PID of the running codepad.exe (the harness refuses to start if one already exists, so it is ours). */
const appPid = () => /"codepad\.exe","(\d+)"/i.exec(execSync('tasklist /FI "IMAGENAME eq codepad.exe" /FO CSV /NH', { encoding: 'utf8' }))?.[1];
const killTree =(pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* already gone */ } };

export const EXE = findExe();

export async function suite(name, opts, fn) {
  if (process.platform !== 'win32') { console.error('These tests drive the Windows build.'); process.exit(2); }
  if (running()) { console.error('Codepad is already running. Close it first: the tests need to be the only instance.'); process.exit(2); }

  const BAK = path.join(os.tmpdir(), `codepad-cfg-backup-${process.pid}`);
  const hadCfg = fs.existsSync(CFG);
  if (hadCfg) fs.cpSync(CFG, BAK, { recursive: true });
  let child = null;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (child?.pid) killTree(child.pid);
    try { fs.rmSync(CFG, { recursive: true, force: true }); } catch { /* ignore */ }
    if (hadCfg) { try { fs.cpSync(BAK, CFG, { recursive: true }); fs.rmSync(BAK, { recursive: true, force: true }); } catch { /* ignore */ } }
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  process.on('exit', restore);
  process.on('SIGINT', () => process.exit(130));

  let pass = 0, fail = 0;
  const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + x : ''}`); };

  const writeFiles = (files = {}) => { for (const [n, data] of Object.entries(files)) { fs.mkdirSync(path.dirname(f(n)), { recursive: true }); fs.writeFileSync(f(n), data); } };

  // ---- connection (re-made on every launch; the helpers below always use the current one)
  let ws = null, nextId = 0, port = 0;
  const waiting = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = ++nextId; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

  const writeConfig = ({ settings, state }) => {
    fs.rmSync(CFG, { recursive: true, force: true });
    fs.mkdirSync(CFG, { recursive: true });
    if (settings !== null) fs.writeFileSync(path.join(CFG, 'settings.json'), JSON.stringify({ ...BASE_SETTINGS, ...settings }));
    if (state) fs.writeFileSync(path.join(CFG, 'state.json'), JSON.stringify({ session: { paths: [], active: null }, recent: [], dismissedUpdate: null, ...state }));
  };

  const resolveArgs = (args = []) => args.map((a) => (!path.isAbsolute(a) && fs.existsSync(f(a)) ? f(a) : a));

  async function launch({ settings = {}, state, args = [], files = {}, ready = 2500, via } = {}) {
    if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
    if (child?.pid) { killTree(child.pid); await sleep(700); child = null; }
    writeFiles(files);
    writeConfig({ settings, state });
    port = 9300 + Math.floor(Math.random() * 600);
    const env = { ...process.env, ...(typeof opts.env === 'function' ? opts.env() : opts.env), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
    child = via ? via(env) : spawn(EXE, resolveArgs(args), { env, stdio: 'ignore' });
    let url;
    for (let i = 0; i < 60 && !url; i++) {
      try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
      if (!url) await sleep(250);
    }
    if (!url) throw new Error('Codepad did not open its debug port');
    ws = new WebSocket(url);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
    if (via) child = { pid: appPid() ?? child.pid }; // the launcher exits quickly; track the app itself
    await sleep(ready);
  }

  const t = {
    check, sleep, send, ev, CTRL, SHIFT, ALT, DIR, f, EXE, REPO, SRC, CFG, spawn, execSync, fs, path, os,
    get port() { return port; },
    /** Start over: stop the app, write new settings/state, launch again. `settings: null` = no settings file.
     *  `via(env)` starts the app some other way (a command line, say) and returns what it spawned. */
    restart: (o = {}) => launch(o),
    /** Write settings.json (merged over the defaults) and wait for the running app to pick it up. */
    async setSettings(o) { fs.writeFileSync(path.join(CFG, 'settings.json'), JSON.stringify({ ...BASE_SETTINGS, ...o })); await sleep(2300); },
    readSettings: () => JSON.parse(fs.readFileSync(path.join(CFG, 'settings.json'), 'utf8')),
    readState: () => { try { return JSON.parse(fs.readFileSync(path.join(CFG, 'state.json'), 'utf8')); } catch { return null; } },
    /** Is the app we started still running? */
    alive: () => !!child && execSync(`tasklist /FI "PID eq ${child.pid}" /NH`, { encoding: 'utf8' }).includes(String(child.pid)),
    /** Open files in the running window the way Explorer does (a second launch, forwarded by the single-instance plugin). */
    openExternally: (...paths) => spawn(EXE, paths, { stdio: 'ignore' }).unref(),
    /** A real key press (keyDown + keyUp). */
    async key(k, code, vk, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: vk });
      await sleep(150);
    },
    async shot(name, clip) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, name.endsWith('.png') ? name : `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })).result.data, 'base64'));
    },
    /** Open the command palette, type `query`; returns the rows, then either runs the first one or closes the palette. */
    async palette(query, run = false) {
      await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(250);
      await ev(`(()=>{const i=document.getElementById('pal-input');i.value=${JSON.stringify(query)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(250);
      const rows = await ev(`[...document.querySelectorAll('#pal-list li')].map(l=>l.querySelector('.pt')?.textContent)`);
      if (run) { await t.key('Enter', 'Enter', 13); await sleep(700); } else await t.key('Escape', 'Escape', 27);
      return rows;
    },
    tabNames: () => ev(`[...document.querySelectorAll('.tab .name')].map(n=>n.textContent.trim())`),
    notes: () => ev(`[...document.querySelectorAll('.note')].map(n=>n.textContent.trim())`),
    docText: () => ev(`document.querySelector('.cm-content').textContent`),
    async goTab(tabName) {
      await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim().startsWith(${JSON.stringify(tabName)}));t.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}))})()`);
      await sleep(300);
    },
    dialog: () => ev(`(()=>{const d=document.getElementById('dialog');if(!d||d.hidden)return null;return {title:d.querySelector('h2').textContent,message:d.querySelector('p')?.textContent??'',items:[...d.querySelectorAll('li')].map(l=>l.textContent),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent),focused:document.activeElement?.textContent}})()`),
    async clickDlg(label) { await ev(`[...document.querySelectorAll('#dialog button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(400); },
  };

  console.log(`\n== ${name}`);
  try {
    await launch({ files: opts.files, settings: opts.settings, state: opts.state, args: opts.args, ready: opts.ready });
    if (opts.size) { await send('Emulation.setDeviceMetricsOverride', { width: opts.size[0], height: opts.size[1], deviceScaleFactor: 1, mobile: false }); await sleep(400); }
    await fn(t);
  } catch (e) {
    fail++; console.log('ERROR', e.stack || e.message);
  } finally {
    console.log(`\n${name}: ${pass} passed, ${fail} failed`);
    restore();
    process.exit(fail ? 1 : 0);
  }
}
