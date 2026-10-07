<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { activate, closeTab, dirName, pickFiles, store, type Tab } from './lib/tabs.svelte';

  const win = getCurrentWindow();
  let tabsEl: HTMLDivElement;

  // Two tabs with the same file name get their parent folder shown next to them.
  const duplicated = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const t of store.tabs) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  });

  // Keep the active tab in view when there are more tabs than fit.
  $effect(() => {
    void store.active;
    void store.tabs.length;
    tabsEl.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  function onTabDown(e: MouseEvent, tb: Tab) {
    if ((e.target as Element).closest('.x')) return; // the close button handles its own click
    if (e.button === 1) { e.preventDefault(); void closeTab(tb); }
    else if (e.button === 0) activate(tb);
  }
</script>

<header id="titlebar">
  <div id="tabs" role="tablist" bind:this={tabsEl}>
    {#each store.tabs as tb (tb)}
      <div
        class="tab"
        class:active={tb === store.active}
        class:missing={tb.missing}
        class:dirty={tb.dirty}
        class:stale={tb.stale}
        title={tb.stale ? `${tb.path}
Changed on disk since you opened it` : tb.path}
        role="tab"
        tabindex="-1"
        aria-selected={tb === store.active}
        onmousedown={(e) => onTabDown(e, tb)}
      >
        <span class="name">{tb.name}{#if duplicated.has(tb.name)}<span class="dir">{dirName(tb.path)}</span>{/if}</span>
        <button class="x" aria-label={tb.dirty ? 'Close tab (unsaved changes)' : 'Close tab'} onclick={(e) => { e.stopPropagation(); void closeTab(tb); }}>
          <svg class="cross" width="8" height="8" viewBox="0 0 8 8"><path d="M0 0l8 8M8 0L0 8" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
          <svg class="dot" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.2" fill="currentColor" /></svg>
        </button>
      </div>
    {/each}
  </div>

  <button id="add" title="Open file (Ctrl+O)" aria-label="Open file" onclick={() => void pickFiles()}>
    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.3" fill="none" /></svg>
  </button>
  <div class="spacer" data-tauri-drag-region></div>

  <div id="winctl">
    <button id="win-min" aria-label="Minimize" onclick={() => void win.minimize()}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" fill="none" /></svg>
    </button>
    <button id="win-max" aria-label="Maximize" onclick={() => void win.toggleMaximize()}>
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" stroke="currentColor" fill="none" /></svg>
    </button>
    <button id="win-close" aria-label="Close" onclick={() => void win.close()}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" fill="none" /></svg>
    </button>
  </div>
</header>
