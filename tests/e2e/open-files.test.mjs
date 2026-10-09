// Opening files from outside (a second launch), duplicate detection across spellings, the saved session and recent list.
import path from 'node:path';
import { suite, sleep, SRC } from './harness.mjs';

suite('Opening files and session state', { settings: { theme: 'dark' } }, async (t) => {
  const { check, ev } = t;
  const main = path.join(SRC, 'main.ts');

  check('starts empty', (await t.tabNames()).length === 0);

  // one file via several spellings: forward slashes, different case, a ".." detour
  t.openExternally(main.replaceAll('\\', '/'));
  await sleep(1500);
  t.openExternally(path.join(path.dirname(SRC), 'SRC').toLowerCase() + '/MAIN.TS', path.join(SRC, '..', 'src', 'main.ts'));
  await sleep(2000);
  check('same file via 3 spellings -> one tab', (await t.tabNames()).length === 1, JSON.stringify(await t.tabNames()));
  const title = await ev(`document.querySelector('.tab').title`);
  check('tab path has no \\\\?\\ prefix', !title.startsWith(String.fromCharCode(92, 92, 63)), title);

  await t.openExternally(path.join(SRC, 'style.css'), path.join(SRC, 'App.svelte'));
  await sleep(1500);
  check('further files open as more tabs', (await t.tabNames()).length === 3, JSON.stringify(await t.tabNames()));

  await sleep(800);
  const st = t.readState();
  check('state.json has session + recent', st.session.paths.length === 3 && st.recent.length >= 3, JSON.stringify(st).slice(0, 160));

  await t.palette('open settings', true);
  check('Open Settings File opens settings.json', (await t.tabNames()).includes('settings.json'), JSON.stringify(await t.tabNames()));
});
