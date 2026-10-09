// The window's size, position and maximised state are remembered between runs.
import { suite, sleep } from './harness.mjs';

const files = { 'ok.txt': 'hello' };
const first = { window: { x: 120, y: 90, w: 900, h: 600, max: false } };

suite('Window size and position', { files, args: ['ok.txt'], state: first }, async (t) => {
  const { check, ev } = t;
  const win = async (cmd, args = {}) => {
    const expr = "window.__TAURI_INTERNALS__.invoke('plugin:window|" + cmd + "', " + JSON.stringify({ label: 'main', ...args }) + ").then(v => JSON.stringify(v ?? null))";
    return JSON.parse(await ev(expr));
  };
  const saved = () => t.readState()?.window ?? null;

  let size = await win('inner_size'), pos = await win('outer_position');
  check('restores saved size', size.width === 900 && size.height === 600, JSON.stringify(size));
  check('restores saved position', pos.x === 120 && pos.y === 90, JSON.stringify(pos));

  await win('set_size', { value: { Physical: { width: 840, height: 560 } } });
  await win('set_position', { value: { Physical: { x: 200, y: 150 } } });
  await sleep(1500);
  let w = saved();
  check('moving/resizing is saved', w && w.x === 200 && w.y === 150 && w.w === 840 && w.h === 560 && w.max === false, JSON.stringify(w));
  await win('toggle_maximize'); await sleep(1500);
  w = saved();
  check('maximizing saves max=true and keeps the normal bounds', w && w.max === true && w.w === 840 && w.x === 200, JSON.stringify(w));

  await t.restart({ files, args: ['ok.txt'], state: { window: w } });
  check('maximized state restored', (await win('is_maximized')) === true);
  await win('toggle_maximize'); await sleep(1500);
  size = await win('inner_size');
  check('un-maximizing returns to the remembered bounds', size.width === 840 && size.height === 560, JSON.stringify(size));
  check('un-maximizing is saved', saved()?.max === false);

  await t.restart({ files, args: ['ok.txt'], state: { window: { x: 99999, y: 99999, w: 800, h: 500, max: false } } });
  pos = await win('outer_position'); size = await win('inner_size');
  check('off-screen saved position is ignored (window on a monitor)', pos.x > -100 && pos.x < 1900 && pos.y > -100 && pos.y < 1000, JSON.stringify(pos));
  check('size still restored when position is rejected', size.width === 800 && size.height === 500, JSON.stringify(size));

  await t.restart({ files, args: ['ok.txt'], state: { window: { x: 5, y: 5, w: 10, h: 10, max: false } } });
  check('garbage bounds ignored (default size)', (await win('inner_size')).width > 400);
});
