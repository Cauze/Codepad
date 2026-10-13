// The in-app updater on a Mac, end to end, against a fake GitHub on localhost: refuses bad downloads, and
// swaps in a good one (download, checksum, unpack, signature, version, swap, restart).
// A debug build can be pointed at a fake release server and told it is older than it is; release builds can't.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

if (process.platform !== 'darwin') { console.log('SKIP  this one is for the macOS updater'); process.exit(0); }

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const built = ['debug', 'release']
  .map((p) => path.join(REPO, 'src-tauri', 'target', p, 'bundle', 'macos', 'Codepad.app'))
  .filter((p) => fs.existsSync(p))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!built || !/debug/.test(built)) { console.log('SKIP  needs the debug app (npx tauri build --debug --bundles app --features e2e): only debug builds accept a fake release server'); process.exit(0); }

// ---- the app under test lives in a scratch folder, so it can replace itself there
const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-update-')));
const INSTALLED = path.join(W, 'install', 'Codepad.app');
fs.mkdirSync(path.dirname(INSTALLED));
execFileSync('/usr/bin/ditto', [built, INSTALLED]);
process.env.CODEPAD_EXE = path.join(INSTALLED, 'Contents', 'MacOS', 'codepad');
const { suite, sleep } = await import('./harness.mjs');

const plist = (app, key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
const VERSION = plist(built, 'CFBundleShortVersionString');
const sign = (app) => execFileSync('/usr/bin/codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'ignore' });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** A copy of the app with `tweak` applied, packed the way the release workflow packs it. */
function pack(name, tweak) {
  const dir = path.join(W, name);
  fs.mkdirSync(dir);
  const app = path.join(dir, 'Codepad.app');
  execFileSync('/usr/bin/ditto', [built, app]);
  tweak?.(app);
  const archive = path.join(W, `${name}.app.tar.gz`);
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', dir, 'Codepad.app']);
  return { archive, digest: sha(archive) };
}

const good = pack('good', (app) => { fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'UPDATED'), 'yes\n'); sign(app); });
const wrongVersion = pack('wrongversion', (app) => { execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleShortVersionString 9.9.9', path.join(app, 'Contents', 'Info.plist')]); sign(app); });
const unsigned = pack('tampered', (app) => { fs.appendFileSync(path.join(app, 'Contents', 'MacOS', 'codepad'), 'tamper'); }); // signature no longer matches
const notAnApp = (() => { const d = path.join(W, 'junk'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'readme.txt'), 'x'); const a = path.join(W, 'junk.tar.gz'); execFileSync('/usr/bin/tar', ['-czf', a, '-C', d, 'readme.txt']); return { archive: a, digest: sha(a) }; })();

// ---- the fake GitHub
let scenario = { archive: good.archive, digest: good.digest, tag: `v${VERSION}`, asset: `Codepad_${VERSION}_universal.app.tar.gz` };
const server = http.createServer((req, res) => {
  if (req.url === '/releases/latest') {
    const base = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      tag_name: scenario.tag, html_url: `${base}/notes`, prerelease: false, draft: false,
      assets: scenario.asset ? [{ name: scenario.asset, browser_download_url: `${base}/dl`, size: fs.statSync(scenario.archive).size, digest: `sha256:${scenario.digest}` }] : [],
    }));
  } else if (req.url === '/dl') {
    res.setHeader('content-type', 'application/gzip');
    fs.createReadStream(scenario.archive).pipe(res);
  } else { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${server.address().port}/releases/latest`;

process.on('exit', () => {
  try { execSync(`pkill -f ${JSON.stringify(INSTALLED)} || true`); } catch { /* none */ }
  try { fs.rmSync(W, { recursive: true, force: true }); } catch { /* ignore */ }
});

suite('Updater (macOS)', { settings: { checkForUpdates: false }, env: { CODEPAD_UPDATE_API: API, CODEPAD_FAKE_CURRENT: '0.0.1' } }, async (t) => {
  const { check, ev } = t;
  const toast = () => ev(`document.getElementById('toast')?.innerText ?? null`);
  const marker = path.join(INSTALLED, 'Contents', 'Resources', 'UPDATED');
  const check_ = async () => { await t.palette('Check for Updates', true); await sleep(1500); };
  const install = async () => { await t.palette('Install Update', true); await sleep(2500); };
  const ready = async () => { try { return await t.evRaw('document.readyState'); } catch { return null; } }; // the bridge is down while the app restarts
  const unchanged = () => !fs.existsSync(marker) && plist(INSTALLED, 'CFBundleShortVersionString') === VERSION && fs.readdirSync(path.dirname(INSTALLED)).join() === 'Codepad.app';

  // ---- finding the update
  await check_();
  let msg = await toast();
  check('an update is found', new RegExp(`Codepad ${VERSION} is available`).test(msg ?? ''), msg);
  check('...as "Install Update" in the palette', (await t.palette('Install Update')).some((r) => /Install Update/.test(r)));

  // ---- downloads it refuses, each leaving the installed app exactly as it was
  scenario = { ...scenario, archive: good.archive, digest: '0'.repeat(64) };
  await check_(); await install();
  msg = await toast();
  check('a download that doesn\'t match the published checksum is refused', /checksum/i.test(msg ?? '') && unchanged() && t.alive(), msg);

  scenario = { ...scenario, archive: notAnApp.archive, digest: notAnApp.digest };
  await check_(); await install();
  msg = await toast();
  check('an archive with no app in it is refused', /doesn.t contain an app/i.test(msg ?? '') && unchanged() && t.alive(), msg);

  scenario = { ...scenario, archive: unsigned.archive, digest: unsigned.digest };
  await check_(); await install();
  msg = await toast();
  check('an app whose signature is broken is refused', /verify the new app/i.test(msg ?? '') && unchanged() && t.alive(), msg);

  scenario = { ...scenario, archive: wrongVersion.archive, digest: wrongVersion.digest };
  await check_(); await install();
  msg = await toast();
  check('an app of another version than announced is refused', /9\.9\.9/.test(msg ?? '') && unchanged() && t.alive(), msg);

  scenario = { ...scenario, asset: null };
  await check_();
  msg = await toast();
  check('a release with no macOS download says so', /no macOS download/i.test(msg ?? ''), msg);

  check('after all that, nothing is left lying around next to the app', unchanged());

  // ---- the real thing
  scenario = { archive: good.archive, digest: good.digest, tag: `v${VERSION}`, asset: `Codepad_${VERSION}_universal.app.tar.gz` };
  await check_();
  const oldPid = t.alive() ? execSync('pgrep -n -x codepad', { encoding: 'utf8' }).trim() : '';
  await t.palette('Install Update', true);
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { await sleep(250); gone = !t.alive(); }
  check('the app quits to be replaced', gone);

  let back = false, pid = '';
  for (let i = 0; i < 60 && !back; i++) {
    await sleep(500);
    pid = execSync('pgrep -n -x codepad || true', { encoding: 'utf8' }).trim();
    back = !!pid && pid !== oldPid && (await ready()) === 'complete';
  }
  check('the new app starts by itself (a different process)', back && pid !== oldPid, `${oldPid} -> ${pid}`);
  check('...from the same place', back && execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }).startsWith(INSTALLED), back ? execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }) : '');
  check('...and it is the downloaded one', fs.existsSync(marker));
  check('...whose signature is intact', (() => { try { execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', INSTALLED], { stdio: 'ignore' }); return true; } catch { return false; } })());
  await sleep(3000);
  check('the old copy and the staging folder are cleaned up', fs.readdirSync(path.dirname(INSTALLED)).join() === 'Codepad.app', fs.readdirSync(path.dirname(INSTALLED)).join());
  check('the new app is up and showing its window', (await t.evRaw('document.title')) === 'Codepad');
  try { execSync(`kill ${pid}`); } catch { /* gone */ }
  server.close();
});
