<script lang="ts">
  import { dismissUpdate, installUpdate, openReleasePage, upd } from './lib/update.svelte';

  const pct = $derived(upd.total > 0 ? Math.min(100, Math.floor((upd.done / upd.total) * 100)) : 0);
</script>

{#if upd.toast}
  <div id="toast" class:err={upd.phase === 'error'} role="status" aria-live="polite">
    {#if upd.phase === 'checking'}
      <div class="t-body"><b>Checking for updates…</b></div>
    {:else if upd.phase === 'current'}
      <div class="t-body"><b>Codepad is up to date</b><span>You have version {upd.current}.</span></div>
    {:else if upd.phase === 'available' && upd.info}
      <div class="t-body">
        <b>Codepad {upd.info.version} is available</b>
        <span>You have {upd.current}.</span>
      </div>
      <div class="t-actions">
        <button class="primary" onclick={() => void installUpdate()}>Update &amp; restart</button>
        <button onclick={() => openReleasePage(upd.info?.notesUrl)}>Release notes</button>
      </div>
    {:else if upd.phase === 'downloading' || upd.phase === 'restarting'}
      <div class="t-body">
        <b>{upd.phase === 'restarting' ? 'Installing and restarting…' : `Downloading ${upd.info?.version ?? ''}… ${pct}%`}</b>
        <div class="bar"><div style:width="{upd.phase === 'restarting' ? 100 : pct}%"></div></div>
      </div>
    {:else if upd.phase === 'error'}
      <div class="t-body"><b>{upd.info ? 'The update didn’t install' : 'Couldn’t check for updates'}</b><span>{upd.message}</span></div>
      <div class="t-actions">
        {#if upd.info}<button class="primary" onclick={() => void installUpdate()}>Try again</button>{/if}
        <button onclick={() => openReleasePage(upd.info?.notesUrl)}>Open release page</button>
      </div>
    {/if}
    {#if upd.phase !== 'downloading' && upd.phase !== 'restarting'}
      <button class="t-x" onclick={dismissUpdate} aria-label="Dismiss" title="Dismiss">×</button>
    {/if}
  </div>
{/if}
