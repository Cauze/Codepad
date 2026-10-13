// The window's size, position and maximised state are remembered between runs.
import { suite, sleep, IS_MAC } from './harness.mjs';

const files = { 'ok.txt': 'hello' };
// Sizes are physical pixels. A Retina screen has twice as many of them per point, and the window has a minimum size in points.
const k = IS_MAC ? 2 : 1;
const first = { window: { x: 120 * k, y: 90 * k, w: 900 * k, h: 600 * k, max: false } };

suite('Window size and position', { files, args: ['ok.txt'], state: first }, async (t) => {
  const { check, ev } = t;
  const win = async (cmd, args = {}) => {
    const expr = "window.__TAURI_INTERNALS__.invoke('plugin:window|" + cmd + "', " + JSON.stringify({ label: 'main', ...args }) + ").then(v => JSON.stringify(v ?? null))";
    return JSON.parse(await ev(expr));
  };
  const saved = () => t.readState()?.window ?? null;

  let size = await win('inner_size'), pos = await win('outer_position');
  check('restores saved size', size.width === 900 * k && size.height === 600 * k, JSON.stringify(size));
  check('restores saved position', pos.x === 120 * k && pos.y === 90 * k, JSON.stringify(pos));

  await win('set_size', { value: { Physical: { width: 840 * k, height: 560 * k } } });
  await win('set_position', { value: { Physical: { x: 200 * k, y: 150 * k } } });
  await sleep(1500);
  let w = saved();
  check('moving/resizing is saved', w && w.x === 200 * k && w.y === 150 * k && w.w === 840 * k && w.h === 560 * k && w.max === false, JSON.stringify(w));
  await win('toggle_maximize'); await sleep(1500);
  w = saved();
  check('maximizing saves max=true and keeps the normal bounds', w && w.max === true && w.w === 840 * k && w.x === 200 * k, JSON.stringify(w));

  await t.restart({ files, args: ['ok.txt'], state: { window: w } });
  check('maximized state restored', (await win('is_maximized')) === true);
  await win('toggle_maximize'); await sleep(1500);
  size = await win('inner_size');
  check('un-maximizing returns to the remembered bounds', size.width === 840 * k && size.height === 560 * k, JSON.stringify(size));
  check('un-maximizing is saved', saved()?.max === false);

  await t.restart({ files, args: ['ok.txt'], state: { window: { x: 99999, y: 99999, w: 800 * k, h: 500 * k, max: false } } });
  pos = await win('outer_position'); size = await win('inner_size');
  check('off-screen saved position is ignored (window on a monitor)', pos.x > -100 && pos.x < 1900 * k && pos.y > -100 && pos.y < 1000 * k, JSON.stringify(pos));
  check('size still restored when position is rejected', size.width === 800 * k && size.height === 500 * k, JSON.stringify(size));

  await t.restart({ files, args: ['ok.txt'], state: { window: { x: 5, y: 5, w: 10, h: 10, max: false } } });
  check('garbage bounds ignored (default size)', (await win('inner_size')).width > 400 * k);
});
