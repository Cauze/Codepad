<script lang="ts">
  import { status, store } from './lib/tabs.svelte';
  import { showUpdateNotice, upd } from './lib/update.svelte';
</script>

<footer id="status">
  <span id="st-pos">{status.pos}</span>
  <span id="st-lines">{status.lines}</span>
  <span class="grow"></span>
  {#if upd.info && (upd.phase === 'available' || upd.phase === 'error') && !upd.toast}
    <button id="st-update" onclick={showUpdateNotice} title="A newer version of Codepad is available">↑ {upd.info.version} available</button>
  {/if}
  <span id="st-lang">{store.active?.lang ?? ''}</span>
  <span id="st-enc">UTF-8</span>
</footer>
