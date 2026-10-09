// cursorStyle and cursorBlink.
import { suite } from './harness.mjs';

const files = { 'sample.lua': 'local function add(a, b)\n  return a + b\nend\n\nprint(add(1, 2))\n' };

suite('Cursor style and blink', { files, args: ['sample.lua'], settings: { fontSize: 15, cursorBlink: false }, size: [800, 400], ready: 3000 }, async (t) => {
  const { check, ev, key, setSettings } = t;
  const clip = async (name) => {
    const r = await ev(`(()=>{const c=document.querySelector('.cm-cursor').getBoundingClientRect();return {x:Math.max(0,c.left-60),y:Math.max(0,c.top-20),w:200,h:60}})()`);
    await t.shot(name, { x: r.x, y: r.y, width: r.w, height: r.h, scale: 3 });
  };
  const cs = () => ev(`(()=>{const e=document.querySelector('.cm-cursor');const s=getComputedStyle(e);return {color:s.borderLeftColor,bl:s.borderLeftWidth,bb:s.borderBottomWidth,w:s.width,bg:s.backgroundColor,anim:getComputedStyle(document.querySelector('.cm-cursorLayer')).animationName}})()`);

  await ev(`document.querySelector('.cm-content').focus()`);
  await key('ArrowDown', 'ArrowDown', 40); await key('ArrowRight', 'ArrowRight', 39); await key('ArrowRight', 'ArrowRight', 39); await key('ArrowRight', 'ArrowRight', 39);
  let s = await cs();
  check('dark: line cursor is light, not black', s.color === 'rgb(192, 202, 245)' && s.bl === '2px', JSON.stringify(s));
  check('blink off: no animation', s.anim === 'none', s.anim);
  await clip('cursor-line-dark');

  await setSettings({ theme: 'dark', fontSize: 15, cursorStyle: 'block', cursorBlink: false });
  await ev(`document.querySelector('.cm-content').focus()`);
  s = await cs();
  const cw = await ev(`(()=>{const sp=document.createElement('span');sp.textContent='MMMMMMMMMM';sp.style.cssText='position:absolute;visibility:hidden;white-space:pre';document.querySelector('.cm-scroller').append(sp);const w=sp.getBoundingClientRect().width/10;sp.remove();return w})()`);
  check('block: one character wide, filled', s.bl === '0px' && Math.abs(parseFloat(s.w) - cw) < 0.6 && s.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(s) + ' charW=' + cw.toFixed(2));
  await clip('cursor-block-dark');

  await setSettings({ theme: 'dark', fontSize: 15, cursorStyle: 'underline', cursorBlink: false });
  await ev(`document.querySelector('.cm-content').focus()`);
  s = await cs();
  check('underline: bottom border only', s.bl === '0px' && s.bb === '2px', JSON.stringify(s));
  await clip('cursor-underline-dark');

  await setSettings({ theme: 'light', fontSize: 15, cursorStyle: 'line', cursorBlink: true });
  await ev(`document.querySelector('.cm-content').focus()`);
  s = await cs();
  check('light: line cursor is dark', s.color === 'rgb(52, 59, 88)', JSON.stringify(s));
  check('blink on: animated', s.anim !== 'none', s.anim);
});
