<script lang="ts">
  import { changeSetting, settings } from './lib/config.svelte';
  import { canEdit, status, store } from './lib/tabs.svelte';
  import { showUpdateNotice, upd } from './lib/update.svelte';
</script>

<footer id="status">
  <span id="st-pos">{status.pos}</span>
  <span id="st-lines">{status.lines}</span>
  <span class="grow"></span>
  {#if upd.info && (upd.phase === 'available' || upd.phase === 'error') && !upd.toast}
    <button id="st-update" onclick={showUpdateNotice} title="A newer version of Codepad is available">↑ {upd.info.version} available</button>
  {/if}
  {#if store.active && !canEdit(store.active)}
    <button
      id="st-ro"
      title={settings.editable ? "This file can't be edited (binary, too large, or not UTF-8)" : 'Editing is off. Click to turn it on.'}
      onclick={() => { if (!settings.editable) changeSetting('editable', true); }}
    >Read-only</button>
  {/if}
  <span id="st-lang">{store.active?.lang ?? ''}</span>
  {#if store.active?.writable}<span id="st-eol">{store.active.crlf ? 'CRLF' : 'LF'}</span>{/if}
  <span id="st-enc">UTF-8</span>
</footer>
