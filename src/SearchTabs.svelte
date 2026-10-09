<script lang="ts">
  import { tick } from 'svelte';
  import { closeSearch, flatHits, jumpTo, onSearchKeydown, results, searchSoon, toggle, ts } from './lib/searchTabs.svelte';

  let input: HTMLInputElement;
  let list: HTMLDivElement;

  $effect(() => {
    void ts.focusReq;
    if (ts.open) void tick().then(() => { input.focus(); input.select(); });
  });

  // Keep the highlighted result in view while arrowing.
  $effect(() => {
    void ts.sel;
    void results.total;
    void tick().then(() => list?.querySelector('.hit.sel')?.scrollIntoView({ block: 'nearest' }));
  });

  const flat = $derived(flatHits());
  const summary = $derived(
    ts.error ? ts.error
    : !ts.query ? 'Search the text of all open files'
    : results.total === 0 ? 'No results'
    : `${results.total.toLocaleString()}${results.truncated ? '+' : ''} result${results.total === 1 ? '' : 's'} in ${results.groups.length} file${results.groups.length === 1 ? '' : 's'}`,
  );
  const indexOf = (g: number, i: number): number => results.groups.slice(0, g).reduce((n, x) => n + x.hits.length, 0) + i;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div id="tsearch" hidden={!ts.open} onmousedown={(e) => { if (e.target === e.currentTarget) closeSearch(); }}>
  <div class="ts-box" role="dialog" aria-label="Search open files">
    <div class="ts-bar">
      <input
        id="ts-input"
        type="text"
        bind:this={input}
        bind:value={ts.query}
        placeholder="Search open files…"
        spellcheck="false"
        autocomplete="off"
        oninput={searchSoon}
        onkeydown={onSearchKeydown}
      />
      <button class="ts-opt" class:on={ts.caseSensitive} title="Match case (Alt+C)" aria-pressed={ts.caseSensitive} onmousedown={(e) => { e.preventDefault(); toggle('caseSensitive'); }}>Aa</button>
      <button class="ts-opt" class:on={ts.wholeWord} title="Whole word (Alt+W)" aria-pressed={ts.wholeWord} onmousedown={(e) => { e.preventDefault(); toggle('wholeWord'); }}><u>ab</u></button>
      <button class="ts-opt" class:on={ts.regex} title="Regular expression (Alt+R)" aria-pressed={ts.regex} onmousedown={(e) => { e.preventDefault(); toggle('regex'); }}>.*</button>
    </div>
    <div id="ts-summary" class:err={!!ts.error}>{summary}</div>
    <div id="ts-list" bind:this={list}>
      {#each results.groups as g, gi (g.tab)}
        <div class="grp">
          <span class="gname">{g.tab.name}</span>
          <span class="gcount">{g.hits.length}{results.truncated && gi === results.groups.length - 1 ? '+' : ''}</span>
        </div>
        {#each g.hits as h, i (h.from)}
          {@const n = indexOf(gi, i)}
          <div
            class="hit"
            class:sel={n === ts.sel}
            role="option"
            aria-selected={n === ts.sel}
            tabindex="-1"
            onmousemove={() => { if (ts.sel !== n) ts.sel = n; }}
            onmousedown={(e) => { e.preventDefault(); jumpTo(flat[n] ?? h); }}
          >
            <span class="ln">{h.line}</span>
            <span class="txt">{h.before}<mark>{h.match}</mark>{h.after}</span>
          </div>
        {/each}
      {/each}
    </div>
  </div>
</div>
