<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { appState, settings } from './lib/config.svelte';
  import * as editor from './lib/editor';
  import { handleKeydown, handleWheel } from './lib/keys';
  import { applyEditorSettings, baseName, boot, openPath, setStatus, startWatching, store } from './lib/tabs.svelte';
  import Palette from './Palette.svelte';
  import StatusBar from './StatusBar.svelte';
  import TitleBar from './TitleBar.svelte';

  const DEFAULT_MONO = "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace";

  let host: HTMLDivElement;

  // "system" follows the OS; this tracks it so the effect below re-runs when it flips.
  const systemLight = matchMedia('(prefers-color-scheme: light)');
  let osLight = $state(systemLight.matches);

  onMount(() => {
    editor.createEditor(host, setStatus);
    const onOs = (e: MediaQueryListEvent) => (osLight = e.matches);
    systemLight.addEventListener('change', onOs);
    // Not via <svelte:window>: a window-level wheel listener is passive there, and we need preventDefault.
    window.addEventListener('wheel', handleWheel, { passive: false });
    startWatching(() => { /* settings effects below react on their own */ });
    void boot();
    return () => {
      systemLight.removeEventListener('change', onOs);
      window.removeEventListener('wheel', handleWheel);
    };
  });

  $effect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme === 'system' ? (osLight ? 'light' : 'dark') : settings.theme;
    root.style.setProperty('--fs', settings.fontSize + 'px');
    const ff = settings.fontFamily;
    if (ff) root.style.setProperty('--mono', `${/[,"']/.test(ff) ? ff : `"${ff}"`}, ${DEFAULT_MONO}`);
    else root.style.removeProperty('--mono');
    editor.requestMeasure();
  });

  $effect(() => {
    void settings.wordWrap;
    void settings.lineNumbers;
    untrack(applyEditorSettings);
  });
</script>

<svelte:window onkeydown={handleKeydown} oncontextmenu={(e) => e.preventDefault()} />

<TitleBar />

<main id="stage">
  <div id="editor" class:hidden={!store.active} bind:this={host}></div>
  <div id="empty" class:show={!store.active}>
    <div class="empty-inner">
      <div class="logo">{'{ }'}</div>
      <p>Drop a file here or press <kbd>Ctrl</kbd> <kbd>O</kbd></p>
      <ul id="recent">
        {#each appState.recent as p (p)}
          <li>
            <button onclick={() => void openPath(p)}>
              <span>{baseName(p)}</span>
              <span class="rp">{p.slice(0, p.length - baseName(p).length)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</main>

<StatusBar />
<Palette />
