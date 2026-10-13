// Shared plumbing for the end-to-end tests.
//
// Each test file launches the real Codepad app and drives its page without OS-level input, so it never
// takes over the mouse or keyboard:
//   - Windows: over WebView2's DevTools port (the Chrome DevTools protocol).
//   - macOS: over the test bridge in src-tauri/src/e2e.rs, which only exists in builds made with
//     `--features e2e`. Key presses and mouse clicks are sent to the page as DOM events.
// A test is:
//
//   import { suite } from './harness.mjs';
//   suite('Name', { files: { 'a.txt': 'hello' }, args: ['a.txt'], settings: { editable: true } }, async (t) => {
//     const { check, ev, sleep } = t;
//     check('opened', (await t.tabNames()).includes('a.txt'));
//   });
//
// Safety: the tests swap in their own settings. On Windows they back up %APPDATA%\Codepad first and put it
// back afterwards; on macOS the app runs with a throw-away HOME, so your own settings are never touched.
// They refuse to start while a Codepad is already running (they would talk to it, because the app is
// single-instance). Close Codepad before running them.
//
// Which exe: $CODEPAD_EXE, else
//   Windows: src-tauri/target/release/codepad.exe (build it with `npx tauri build --no-bundle`)
//   macOS:   the newest Codepad.app under src-tauri/target/{debug,release}/bundle/macos
//            (build it with `npx tauri build --debug --bundles app --features e2e`)
//
// On macOS a test's CTRL means the shortcut key, which is Cmd there: key() and any `ctrlKey:true` in a
// script that ev() runs are turned into Cmd. Use evRaw() for a script that really means the Control key.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IS_MAC = process.platform === 'darwin';
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = path.join(REPO, 'src');
const OUT = path.join(REPO, 'tests', 'e2e', '.out'); // screenshots; git-ignored
/** macOS: the app's HOME for this run, so its settings land here instead of in the real ~/Library. */
const TEST_HOME = IS_MAC ? fs.mkdtempSync(path.join(os.tmpdir(), 'cp-home-')) : null;
export const CFG = IS_MAC ? path.join(TEST_HOME, 'Library', 'Application Support', 'Codepad') : path.join(process.env.APPDATA ?? '', 'Codepad');
const BASE_SETTINGS = { theme: 'dark', checkForUpdates: false, startup: 'empty' };

/** A scratch folder for this test's fixture files; it is deleted when the test ends. */
export const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-e2e-'))); // resolved: on macOS /var is a link to /private/var, and Codepad always shows the resolved path
export const f = (n) => path.join(DIR, n);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CTRL = 2, SHIFT = 8, ALT = 1;

function findExe() {
  let exe = process.env.CODEPAD_EXE;
  if (!exe && IS_MAC) {
    const apps = ['debug', 'release'].map((p) => path.join(REPO, 'src-tauri', 'target', p, 'bundle', 'macos', 'Codepad.app', 'Contents', 'MacOS', 'codepad')).filter((p) => fs.existsSync(p));
    exe = apps.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  exe ??= path.join(REPO, 'src-tauri', 'target', 'release', 'codepad.exe');
  if (!fs.existsSync(exe)) {
    console.error(`Codepad not found: ${exe}\nBuild it with ${IS_MAC ? '"npx tauri build --debug --bundles app --features e2e"' : '"npx tauri build --no-bundle"'} or set CODEPAD_EXE.`);
    process.exit(2);
  }
  return exe;
}

const running = () => IS_MAC
  ? execSync('pgrep -x codepad || true', { encoding: 'utf8' }).trim() !== ''
  : /codepad\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq codepad.exe" /NH', { encoding: 'utf8' }));
/** PID of the running Codepad (the harness refuses to start if one already exists, so it is ours). */
const appPid = () => IS_MAC
  ? execSync('pgrep -n -x codepad || true', { encoding: 'utf8' }).trim() || undefined
  : /"codepad\.exe","(\d+)"/i.exec(execSync('tasklist /FI "IMAGENAME eq codepad.exe" /FO CSV /NH', { encoding: 'utf8' }))?.[1];
const killTree = (pid) => {
  if (IS_MAC) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ } return; }
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* already gone */ }
};
const pidAlive = (pid) => {
  if (IS_MAC) { try { process.kill(Number(pid), 0); return true; } catch { return false; } }
  return execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' }).includes(String(pid));
};
/** The .app that EXE lives in (macOS). */
export const BUNDLE = IS_MAC ? path.resolve(findExe(), '..', '..', '..') : null;

export const EXE = findExe();

export async function suite(name, opts, fn) {
  if (process.platform !== 'win32' && !IS_MAC) { console.error('These tests drive the Windows and macOS builds.'); process.exit(2); }
  if (running()) { console.error('Codepad is already running. Close it first: the tests need to be the only instance.'); process.exit(2); }

  const BAK = path.join(os.tmpdir(), `codepad-cfg-backup-${process.pid}`);
  const hadCfg = !IS_MAC && fs.existsSync(CFG); // on macOS the app never sees your real settings
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
    if (TEST_HOME) try { fs.rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  process.on('exit', restore);
  process.on('SIGINT', () => process.exit(130));

  let pass = 0, fail = 0;
  const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  -> ' + x : ''}`); };

  /** macOS: put the window in front (it stops counting as hidden, so the app's file watching runs). */
  const bringForward = async () => {
    if (!IS_MAC || !BUNDLE.endsWith('.app')) return;
    try { execSync(`open -a ${JSON.stringify(BUNDLE)}`); } catch { /* not in a bundle */ }
    await sleep(500);
  };

  // Another app can cover the window at any moment, and a covered window stops animating (requestAnimationFrame
  // never fires), which several features lean on. So whenever it reports itself hidden, bring it forward again.
  let keeper = null;
  const keepVisible = () => {
    if (!IS_MAC || keeper) return;
    keeper = setInterval(async () => {
      try { if ((await evRaw('document.hidden')) === true) await bringForward(); } catch { /* app restarting */ }
    }, 1000);
    keeper.unref();
  };

  const writeFiles = (files = {}) => { for (const [n, data] of Object.entries(files)) { fs.mkdirSync(path.dirname(f(n)), { recursive: true }); fs.writeFileSync(f(n), data); } };

  // ---- connection (re-made on every launch; the helpers below always use the current one)
  let ws = null, nextId = 0, port = 0;
  const waiting = new Map();
  const cdp = (method, params = {}) => new Promise((res) => { const i = ++nextId; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  // ---- macOS: the same few calls, answered by running DOM code in the page through the bridge
  const bridge = async (route, body = '') => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: route === '/ping' ? 'GET' : 'POST', body: route === '/ping' ? undefined : body });
    return r.json();
  };
  /** CDP modifier bits (alt 1, ctrl 2, meta 4, shift 8) as KeyboardEvent flags. A test's "ctrl" is the Mac's Cmd. */
  const flags = (m = 0) => `altKey:${!!(m & 1)},metaKey:${!!(m & 2 || m & 4)},shiftKey:${!!(m & 8)}`;
  const macSend = async (method, p) => {
    const run = async (js) => { await bridge('/eval', js); return {}; };
    switch (method) {
      case 'Input.dispatchKeyEvent': {
        const type = p.type === 'keyUp' ? 'keyup' : 'keydown';
        // A synthetic key press does nothing by itself, so do what the browser would for Cmd+A in a text box.
        const selectAll = p.type === 'keyDown' && (p.modifiers & (2 | 4)) && p.key.toLowerCase() === 'a';
        return run(`(()=>{const el=document.activeElement||document.body;const ok=el.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:${JSON.stringify(p.key)},code:${JSON.stringify(p.code ?? '')},keyCode:${p.windowsVirtualKeyCode ?? 0},which:${p.windowsVirtualKeyCode ?? 0},bubbles:true,cancelable:true,composed:true,${flags(p.modifiers)}}));
          if(${!!selectAll}&&ok&&(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement))el.select();})()`);
      }
      case 'Input.insertText':
        return run(`document.execCommand('insertText',false,${JSON.stringify(p.text)})`);
      case 'Input.dispatchMouseEvent': {
        const { type, x, y } = p;
        const name = { mouseMoved: 'move', mousePressed: 'down', mouseReleased: 'up' }[type];
        // like a real mouse: a pointer event first, then the mouse event it goes with
        return run(`(()=>{const el=document.elementFromPoint(${x},${y});if(!el)return;const o={bubbles:true,cancelable:true,composed:true,clientX:${x},clientY:${y},button:0,buttons:${type === 'mousePressed' ? 1 : 0},detail:${p.clickCount ?? 0}};
          el.dispatchEvent(new PointerEvent('pointer${name}',{...o,pointerId:1,pointerType:'mouse',isPrimary:true}));
          const ok=el.dispatchEvent(new MouseEvent('mouse${name}',o));
          if(${type === 'mousePressed'}&&ok)(el.closest('input,textarea,[contenteditable],button')||{focus(){}}).focus();
          if(${type === 'mouseReleased'})el.dispatchEvent(new MouseEvent('click',o));})()`);
      }
      case 'Emulation.setDeviceMetricsOverride':
        await bridge(`/resize?w=${p.width}&h=${p.height}`);
        return {};
      case 'Page.captureScreenshot':
        return { result: { data: '' } }; // no pixels without screen-recording permission; screenshots are a Windows-only aid
      default:
        throw new Error(`the macOS bridge doesn't do ${method}`);
    }
  };
  const send = (method, params = {}) => (IS_MAC ? macSend(method, params) : cdp(method, params));
  const ctrlToCmd = (js) => js.replace(/\bctrlKey("?)\s*:\s*true/g, 'metaKey$1:true');
  const evRaw = async (expression) => {
    if (!IS_MAC) return (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const r = await bridge('/eval', expression);
    if (!r.ok) console.log(`  (page error: ${String(r.error).split('\n')[0]})`);
    return r.ok && !r.undef ? r.value : undefined;
  };
  const ev = (expression) => evRaw(IS_MAC ? ctrlToCmd(expression) : expression);

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
    if (IS_MAC) try { fs.rmSync('/tmp/dev.codepad.app_si.sock', { force: true }); } catch { /* ignore */ } // a killed app leaves its single-instance socket behind
    writeFiles(files);
    writeConfig({ settings, state });
    port = 9300 + Math.floor(Math.random() * 600);
    const extra = typeof opts.env === 'function' ? opts.env() : opts.env;
    const env = IS_MAC
      ? { ...process.env, ...extra, HOME: TEST_HOME, CODEPAD_E2E_PORT: String(port) }
      : { ...process.env, ...extra, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
    child = via ? via(env) : spawn(EXE, resolveArgs(args), { env, stdio: 'ignore' });
    if (IS_MAC) {
      let up = false;
      for (let i = 0; i < 80 && !up; i++) {
        try { up = (await bridge('/ping')) === 'pong'; } catch { await sleep(250); }
      }
      if (!up) throw new Error('Codepad did not open its test bridge (is this a build made with --features e2e?)');
      for (let i = 0; i < 40 && (await evRaw('document.readyState + (window.__TAURI_INTERNALS__ ? "+tauri" : "")')) !== 'complete+tauri'; i++) await sleep(250);
      // A window behind other apps counts as hidden to the page (document.hidden), which pauses the app's file
      // watching. Bring it forward, like a user looking at it would.
      await bringForward();
      keepVisible();
    } else {
      let url;
      for (let i = 0; i < 60 && !url; i++) {
        try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
        if (!url) await sleep(250);
      }
      if (!url) throw new Error('Codepad did not open its debug port');
      ws = new WebSocket(url);
      await new Promise((r) => (ws.onopen = r));
      ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
    }
    if (via) child = { pid: appPid() ?? child.pid }; // the launcher exits quickly; track the app itself
    await sleep(ready);
  }

  const t = {
    check, sleep, send, ev, evRaw, CTRL, SHIFT, ALT, DIR, f, EXE, REPO, SRC, CFG, spawn, execSync, fs, path, os,
    get port() { return port; },
    /** Start over: stop the app, write new settings/state, launch again. `settings: null` = no settings file.
     *  `via(env)` starts the app some other way (a command line, say) and returns what it spawned. */
    restart: (o = {}) => launch(o),
    /** Write settings.json (merged over the defaults) and wait for the running app to pick it up. */
    async setSettings(o) { fs.writeFileSync(path.join(CFG, 'settings.json'), JSON.stringify({ ...BASE_SETTINGS, ...o })); await bringForward(); await sleep(2300); },
    bringForward,
    /** macOS: what the Dock's "Quit" does (the app is asked to terminate). */
    terminate: () => bridge('/terminate'),
    readSettings: () => JSON.parse(fs.readFileSync(path.join(CFG, 'settings.json'), 'utf8')),
    readState: () => { try { return JSON.parse(fs.readFileSync(path.join(CFG, 'state.json'), 'utf8')); } catch { return null; } },
    /** Is the app we started still running? */
    alive: () => !!child && pidAlive(child.pid),
    /** Open files in the running window the way Explorer does (a second launch, forwarded by the single-instance plugin). */
    openExternally: (...paths) => spawn(EXE, paths, { stdio: 'ignore' }).unref(),
    /** macOS: open files the way Finder does (LaunchServices hands them to the running app as "open document" events). */
    openViaFinder: (...paths) => spawn('open', ['-a', BUNDLE, ...paths], { stdio: 'ignore' }).unref(),
    /** A real key press (keyDown + keyUp). */
    async key(k, code, vk, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: vk });
      await sleep(150);
    },
    async shot(name, clip) {
      if (IS_MAC) return;
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
