// smoothCursor glides the cursor instead of jumping.
import { suite, sleep } from './harness.mjs';

const files = { 'sample.lua': 'local function add(a, b)\n  return a + b\nend\n\nprint(add(1, 2))\n' };

suite('Smooth cursor', { files, args: ['sample.lua'], settings: { cursorBlink: false }, size: [800, 400], ready: 3000 }, async (t) => {
  const { check, ev, key, setSettings } = t;
  // After a big jump (End key), sample the cursor's on-screen x at intervals.
  const trace = async () => {
    await ev(`document.querySelector('.cm-content').focus()`);
    await key('Home', 'Home', 36); await sleep(400);
    const start = await ev(`document.querySelector('.cm-cursor').getBoundingClientRect().left`);
    // sample in-page at animation frames so timing isn't limited by the CDP round trip
    const samples = await ev(`new Promise(res=>{const out=[];const t0=performance.now();
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'End',code:'End',bubbles:true,keyCode:35}));
      (function f(){out.push(Math.round(document.querySelector('.cm-cursor').getBoundingClientRect().left));if(performance.now()-t0<300)requestAnimationFrame(f);else res(out)})();
    })`);
    return { start: Math.round(start), end: samples[samples.length - 1], samples };
  };
  const mid = (x) => x.samples.filter((v) => v > x.start + 2 && v < x.end - 2).length;

  let r = await trace();
  check('off (default): cursor jumps straight to the new position', r.end > r.start + 20 && mid(r) === 0, JSON.stringify(r.samples.slice(0, 8)));

  await setSettings({ smoothCursor: true });
  r = await trace();
  check('on: cursor passes through intermediate positions', r.end > r.start + 20 && mid(r) >= 2, JSON.stringify(r.samples.slice(0, 12)));
  check('on: still lands exactly on the target', r.samples[r.samples.length - 1] === r.end);
});
