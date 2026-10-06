<script lang="ts">
  import { tick } from 'svelte';
  import { closePalette, choose, onPaletteKeydown, pal, paletteView } from './lib/palette.svelte';

  let input: HTMLInputElement;
  let list: HTMLUListElement;

  const view = $derived(paletteView());

  // Focus the box whenever a session starts (including one that replaces another).
  $effect(() => {
    void pal.focusReq;
    if (pal.open) void tick().then(() => input.focus());
  });

  // Keep the highlighted row visible while arrowing through a long list.
  $effect(() => {
    void pal.sel;
    void view;
    void tick().then(() => list.children[pal.sel]?.scrollIntoView({ block: 'nearest' }));
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div id="palette" hidden={!pal.open} onmousedown={(e) => { if (e.target === e.currentTarget) closePalette(); }}>
  <div class="pal-box" role="dialog" aria-label="Command palette">
    <input
      id="pal-input"
      type="text"
      bind:this={input}
      bind:value={pal.query}
      placeholder={view.placeholder}
      spellcheck="false"
      autocomplete="off"
      oninput={() => (pal.sel = 0)}
      onkeydown={onPaletteKeydown}
    />
    <ul id="pal-list" role="listbox" bind:this={list}>
      {#if view.hint !== null}
        <li class="none">{view.hint}</li>
      {:else}
        {#each view.rows as row, n (row.item)}
          <li
            class:sel={n === pal.sel}
            role="option"
            aria-selected={n === pal.sel}
            onmousemove={() => { if (pal.sel !== n) pal.sel = n; }}
            onmousedown={(e) => { e.preventDefault(); choose(n); }}
          >
            <span class="pt">{#each row.segs as seg}{#if seg.hit}<b>{seg.text}</b>{:else}{seg.text}{/if}{/each}</span>
            {#if row.item.detail}<span class="pd">{row.item.detail}</span>{/if}
            {#if row.item.keys}<span class="pk">{#each row.item.keys.split('+') as k}<kbd>{k}</kbd>{/each}</span>{/if}
          </li>
        {/each}
      {/if}
    </ul>
  </div>
</div>
