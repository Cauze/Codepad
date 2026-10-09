// The "startup" setting: reopen the last files or start empty, with palette commands to switch.
import path from 'node:path';
import { suite, SRC } from './harness.mjs';

const files = [path.join(SRC, 'main.ts'), path.join(SRC, 'style.css')];
const state = { session: { paths: files, active: files[1] }, recent: [] };

suite('Startup behaviour', { settings: { startup: 'restore' }, state }, async (t) => {
  const { check, ev } = t;
  const look = async () => ({
    tabs: await t.tabNames(),
    emptyShown: await ev(`document.getElementById('empty').classList.contains('show')`),
    cmds: (await t.palette('Startup')).filter((n) => n.startsWith('Startup')),
  });

  let r = await look();
  check('startup=restore reopens last files', r.tabs.join(',') === 'main.ts,style.css', JSON.stringify(r.tabs));
  check('restore: palette offers "Start Empty" only', r.cmds.join('|') === 'Startup: Start Empty', JSON.stringify(r.cmds));

  await t.restart({ settings: { startup: 'empty' }, state });
  r = await look();
  check('startup=empty opens no tabs', r.tabs.length === 0 && r.emptyShown, JSON.stringify(r.tabs));
  check('empty: palette offers "Reopen Last Files" only', r.cmds.join('|') === 'Startup: Reopen Last Files', JSON.stringify(r.cmds));
  check('session tracks the current run (empty start -> empty session)', t.readState()?.session.paths.length === 0, JSON.stringify(t.readState()?.session));

  await t.restart({ settings: null, state }); // no settings file at all
  check('default (no settings) restores', (await t.tabNames()).length === 2, JSON.stringify(await t.tabNames()));

  await t.restart({ settings: { startup: 'bogus' }, state });
  check('invalid value falls back to restore', (await t.tabNames()).length === 2, JSON.stringify(await t.tabNames()));
});
