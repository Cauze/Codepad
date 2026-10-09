// The optional minimap and its VS Code-style options.
import { suite, sleep, f } from './harness.mjs';
import fs from 'node:fs';

let big = '// generated\n';
for (let i = 0; i < 400; i++) big += `function fn${i}(a, b) {\n  const total = a + b * ${i};\n  return "value " + total; // line ${i}\n}\n\n`;
fs.writeFileSync(f('big.js'), big);
fs.writeFileSync(f('small.js'), 'const x = 1;\nconsole.log(x);\n');

suite('Minimap', { args: ['big.js', 'small.js'] }, async (t) => {
  const { check, send, ev, shot, key, setSettings } = t;
  const goTab = async (name) => { await ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.querySelector('.name').textContent.trim().startsWith(${JSON.stringify(name)}));t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));})()`); await sleep(500); };
  const mm = () => ev(`(()=>{const m=document.querySelector('.cm-minimap');if(!m)return null;const r=m.getBoundingClientRect();const sd=document.querySelector('.cm-scroller');const c=m.querySelector('canvas');const x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=3;i<x.length;i+=4)if(x[i]>0)ink++;const s=m.querySelector('.cm-minimap-slider');return {left:r.left,right:r.right,top:r.top,h:r.height,w:r.width,ink,marginR:getComputedStyle(sd).marginRight,marginL:getComputedStyle(sd).marginLeft,slider:parseFloat(s.style.top),sliderH:parseFloat(s.style.height),sliderOp:getComputedStyle(s).opacity,cls:m.className,vw:innerWidth}})()`);
  const scrollTop = () => ev(`document.querySelector('.cm-scroller').scrollTop`);

  await sleep(2500);
  await goTab('big.js');
  check('minimap is off by default', (await mm()) === null);
  check('no space reserved when off', (await ev(`getComputedStyle(document.querySelector('.cm-scroller')).marginRight`)) === '0px');

  await setSettings({ minimap: { enabled: true } });
  let m = await mm();
  check('enabling it in settings.json shows the minimap live', m !== null);
  check('it sits on the right edge, beside the text', m && Math.abs(m.right - m.vw) < 2 && m.marginR === `${Math.round(m.w)}px`, JSON.stringify(m));
  check('canvas has content drawn', m && m.ink > 500, m?.ink);
  check('slider reflects the viewport at the top', m && m.slider <= 1 && m.sliderH > 8, `${m?.slider} h=${m?.sliderH}`);
  await shot('minimap-right');

  // scrolling moves the slider
  await ev(`document.querySelector('.cm-scroller').scrollTop = 4000`); await sleep(400);
  const m2 = await mm();
  check('scrolling the editor moves the slider', m2.slider > m.slider + 2, `${m.slider} -> ${m2.slider}`);

  // clicking the minimap scrolls the editor there
  await ev(`document.querySelector('.cm-scroller').scrollTop = 0`); await sleep(300);
  const rect = await ev(`(()=>{const r=document.querySelector('.cm-minimap').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*0.6}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(500);
  check('clicking the minimap scrolls the editor', (await scrollTop()) > 1000, await scrollTop());

  // the minimap window follows long files
  await ev(`document.querySelector('.cm-scroller').scrollTop = 1e9`); await sleep(500);
  const m3 = await mm();
  check('slider reaches the bottom at the end of the file', m3.slider + m3.sliderH > m3.h - 6, JSON.stringify([m3.slider, m3.sliderH, m3.h]));
  await shot('minimap-bottom');

  // other tab: short file
  await goTab('small.js');
  const ms = await mm();
  check('short file: minimap present, slider covers the file', ms !== null && ms.ink > 10);

  // side + slider options
  await setSettings({ minimap: { enabled: true, side: 'left', showSlider: 'always' } });
  const ml = await mm();
  check('side: left', ml && ml.left < 5 && ml.marginL === `${Math.round(ml.w)}px` && ml.marginR === '0px', JSON.stringify(ml));
  check('showSlider: always keeps the slider visible', ml && ml.sliderOp === '1' && /slider-always/.test(ml.cls));
  await shot('minimap-left');

  await setSettings({ minimap: { enabled: true, renderCharacters: false, scale: 2, maxColumn: 60 } });
  const mc = await mm();
  check('scale 2 / maxColumn 60 / blocks still draws', mc && mc.ink > 100 && mc.w <= 140, JSON.stringify([mc?.ink, mc?.w]));
  await shot('minimap-blocks');

  await setSettings({ minimap: { enabled: true, size: 'fill' } });
  await goTab('big.js'); await goTab('small.js');
  const mf = await mm();
  check('size: fill stretches a short file over the height (more ink)', mf && mf.ink > ms.ink * 2, `${ms.ink} -> ${mf?.ink}`);

  // invalid values fall back
  await setSettings({ minimap: { enabled: true, side: 'top', scale: 99, maxColumn: -5, size: 'x' } });
  const mi = await mm();
  check('invalid minimap options fall back to sane values', mi && mi.right > mi.vw - 2 && mi.w > 40);

  // palette toggles
  const runCmd = async (q) => {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,bubbles:true}))`); await sleep(200);
    await ev(`(()=>{const i=document.getElementById('pal-input');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(200);
    await key('Enter', 'Enter', 13); await sleep(500);
  };
  await runCmd('Toggle Minimap');
  check('Toggle Minimap command hides it (and frees the space)', (await mm()) === null && (await ev(`getComputedStyle(document.querySelector('.cm-scroller')).marginRight`)) === '0px');
  await runCmd('Toggle Minimap');
  check('...and shows it again', (await mm()) !== null);
  await sleep(800);
  const saved = t.readSettings();
  check('the choice is written to settings.json', saved.minimap?.enabled === true && 'side' in saved.minimap, JSON.stringify(saved.minimap));

  // light theme colours
  await setSettings({ theme: 'light', minimap: { enabled: true } });
  await shot('minimap-light');
  await goTab('big.js'); await sleep(400); // (the short file only has a few dozen inked pixels)
  const ml2 = await mm();
  const dark = await ev(`(()=>{const c=document.querySelector('.cm-minimap canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>0&&(d[i]+d[i+1]+d[i+2])/3<190)n++;return n})()`);
  check('light theme still draws, in dark ink', ml2 && dark > 100, `dark pixels=${dark}`);
});
