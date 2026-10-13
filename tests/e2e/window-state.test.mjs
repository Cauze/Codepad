// The window's size, position and maximised state are remembered between runs.
import { suite, sleep, IS_MAC } from './harness.mjs';

const files = { 'ok.txt': 'hello' };
// Saved bounds are physical pixels. A Retina screen has twice as many of them per point, and the window has a
// minimum size in points (and the screen a menu bar), so on a Mac the values are kept modest and scaled by the real display's factor.
const V = IS_MAC
  ? { first: { x: 60, y: 60, w: 800, h: 520 }, moved: { x: 100, y: 80, w: 760, h: 480 }, off: { w: 800, h: 500 } }
  : { first: { x: 120, y: 90, w: 900, h: 600 }, moved: { x: 200, y: 150, w: 840, h: 560 }, off: { w: 800, h: 500 } };
const at = (k, b) => Object.fromEntries(Object.entries(b).map(([n, v]) => [n, v * k]));

suite('Window size and position', { files, args: ['ok.txt'] }, async (t) => {
  const { check, ev } = t;
  const win = async (cmd, args = {}) => {
    const expr = "window.__TAURI_INTERNALS__.invoke('plugin:window|" + cmd + "', " + JSON.stringify({ label: 'main', ...args }) + ").then(v => JSON.stringify(v ?? null))";
    return JSON.parse(await ev(expr));
  };
  const saved = () => t.readState()?.window ?? null;

  const k = IS_MAC ? await ev('devicePixelRatio') : 1;
  const first = at(k, V.first), moved = at(k, V.moved), off = at(k, V.off);
  await t.restart({ files, args: ['ok.txt'], state: { window: { ...first, max: false } } });

  let size = await win('inner_size'), pos = await win('outer_position');
  check('restores saved size', size.width === first.w && size.height === first.h, JSON.stringify(size));
  check('restores saved position', pos.x === first.x && pos.y === first.y, JSON.stringify(pos));

  await win('set_size', { value: { Physical: { width: moved.w, height: moved.h } } });
  await win('set_position', { value: { Physical: { x: moved.x, y: moved.y } } });
  await sleep(1500);
  let w = saved();
  check('moving/resizing is saved', w && w.x === moved.x && w.y === moved.y && w.w === moved.w && w.h === moved.h && w.max === false, JSON.stringify(w));
  await win('toggle_maximize'); await sleep(1500);
  w = saved();
  check('maximizing saves max=true and keeps the normal bounds', w && w.max === true && w.w === moved.w && w.x === moved.x, JSON.stringify(w));

  await t.restart({ files, args: ['ok.txt'], state: { window: w } });
  check('maximized state restored', (await win('is_maximized')) === true);
  await win('toggle_maximize'); await sleep(1500);
  size = await win('inner_size');
  check('un-maximizing returns to the remembered bounds', size.width === moved.w && size.height === moved.h, JSON.stringify(size));
  check('un-maximizing is saved', saved()?.max === false);

  await t.restart({ files, args: ['ok.txt'], state: { window: { x: 99999, y: 99999, w: off.w, h: off.h, max: false } } });
  pos = await win('outer_position'); size = await win('inner_size');
  check('off-screen saved position is ignored (window on a monitor)', pos.x > -100 && pos.x < 1900 * k && pos.y > -100 && pos.y < 1000 * k, JSON.stringify(pos));
  check('size still restored when position is rejected', size.width === off.w && size.height === off.h, JSON.stringify(size));

  await t.restart({ files, args: ['ok.txt'], state: { window: { x: 5, y: 5, w: 10, h: 10, max: false } } });
  check('garbage bounds ignored (default size)', (await win('inner_size')).width > 400 * k);
});
