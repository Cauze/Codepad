// settings.json is created on first run, and hand edits are applied live (bad JSON mid-edit is ignored).
import fs from 'node:fs';
import path from 'node:path';
import { suite, sleep, CFG } from './harness.mjs';

suite('Settings applied live', { settings: null }, async (t) => {
  const { check, ev } = t;
  const file = path.join(CFG, 'settings.json');
  const css = (name) => ev(`document.documentElement.style.getPropertyValue(${JSON.stringify(name)})`);

  check('settings.json created on first run', fs.existsSync(file));

  const s = t.readSettings();
  fs.writeFileSync(file, JSON.stringify({ ...s, fontSize: 18, fontFamily: 'Consolas' }, null, 2));
  await sleep(2500);
  check('hand-edited fontSize applied live', (await css('--fs')) === '18px');
  check('hand-edited fontFamily applied live', (await css('--mono')).startsWith('"Consolas"'));

  fs.writeFileSync(file, '{ not json');
  await sleep(2500);
  check('invalid JSON mid-edit is ignored (keeps 18px)', (await css('--fs')) === '18px');

  fs.writeFileSync(file, JSON.stringify({ ...s, fontSize: 13.5, fontFamily: '' }, null, 2));
  await sleep(2500);
  check('fixing the file applies it again', (await css('--fs')) === '13.5px');
});
