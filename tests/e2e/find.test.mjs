// The find widget: floating top-right, live count, next/previous, case and regex toggles, close behaviour.
import path from 'node:path';
import { suite, sleep, SRC } from './harness.mjs';

const args = [path.join(SRC, 'main.ts'), path.join(SRC, 'style.css'), path.join(SRC, 'lib', 'palette.svelte.ts')];

suite('Find widget', { args }, async (t) => {
  const { check, ev, shot } = t;
  const sel = (s) => ev(`!!document.querySelector(${JSON.stringify(s)})`);
  const inputKey = (k, mods = {}) => ev(`document.querySelector('.find input').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true,...${JSON.stringify(mods)}}))`);
  const findType = (text) => ev(`(()=>{const i=document.querySelector('.find input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const count = () => ev(`document.querySelector('.find-count').textContent`);
  const ctrlF = () => ev(`document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))`);
  const idxOf = (s) => Number(/^(\d+) of/.exec(s)?.[1] ?? NaN);

  const top0 = await ev(`document.querySelector('.cm-scroller').getBoundingClientRect().top`);
  check('no find widget before Ctrl+F', !(await sel('.find')));
  await ctrlF(); await sleep(300);
  check('Ctrl+F opens the widget', await sel('.find'));
  check('input is focused', await ev(`document.activeElement === document.querySelector('.find input')`));
  const r = JSON.parse(await ev(`(()=>{const f=document.querySelector('.find').getBoundingClientRect(), e=document.querySelector('.cm-editor').getBoundingClientRect(); return JSON.stringify({fTop:f.top-e.top, fRight:e.right-f.right, fW:f.width, scrollerMoved: document.querySelector('.cm-scroller').getBoundingClientRect().top});})()`));
  check('widget floats at the top-right', r.fTop <= 1 && r.fRight > 5 && r.fRight < 60, JSON.stringify(r));
  check('widget does not push the text down', Math.abs(r.scrollerMoved - top0) < 1, `${top0} -> ${r.scrollerMoved}`);

  await findType('import'); await sleep(300);
  const c = await count();
  check('typing shows "N of M"', /^\d+ of \d+$/.test(c), c);
  check('matches are highlighted in the text', await sel('.cm-searchMatch'));
  await shot('find');
  const first = idxOf(c);
  await inputKey('Enter'); await sleep(200);
  check('Enter goes to next match', idxOf(await count()) === first + 1, `${first} -> ${await count()}`);
  await inputKey('Enter', { shiftKey: true }); await sleep(200);
  check('Shift+Enter goes back', idxOf(await count()) === first, await count());

  await findType('IMPORT'); await sleep(200);
  const insens = await count();
  await inputKey('c', { altKey: true }); await sleep(250);
  const sens = await count();
  check('Alt+C toggles match case', (await sel('.find button.on')) && sens === 'No results' && /\d+ of \d+/.test(insens), `${insens} -> ${sens}`);
  await inputKey('c', { altKey: true }); await sleep(200);

  await inputKey('r', { altKey: true }); await findType('('); await sleep(250);
  check('bad regex says Invalid regex', (await count()) === 'Invalid regex', await count());
  await findType('imp(or)+t'); await sleep(250);
  check('good regex finds matches', /^\d+ of \d+$/.test(await count()), await count());
  await inputKey('r', { altKey: true });

  await findType('zzzqqqxxx'); await sleep(250);
  check('no matches -> "No results"', (await count()) === 'No results');
  check('prev/next disabled with no matches', await ev(`[...document.querySelectorAll('.find button')].filter(b=>/^(Previous|Next) Match/.test(b.title)).every(b=>b.disabled)`));

  await findType('export'); await sleep(250);
  await ev(`document.querySelector('.find button[title^="Next"]').click()`); await sleep(200);
  check('clicking the next arrow works', idxOf(await count()) >= 2, await count());

  await inputKey('Escape'); await sleep(250);
  check('Escape closes the widget', !(await sel('.find')));
  check('focus returns to the editor', await ev(`document.activeElement?.classList.contains('cm-content')`));

  await ctrlF(); await sleep(250);
  check('reopens with the last query', (await ev(`document.querySelector('.find input').value`)) === 'export');
  await ev(`document.querySelector('.find button[title^="Close"]').click()`); await sleep(200);
  check('close button closes it', !(await sel('.find')));
});
