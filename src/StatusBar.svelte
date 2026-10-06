<script lang="ts">
  import { status, store } from './lib/tabs.svelte';
</script>

<footer id="status">
  <span id="st-pos">{status.pos}</span>
  <span id="st-lines">{status.lines}</span>
  <span class="grow"></span>
  <span id="st-lang">{store.active?.lang ?? ''}</span>
  <span id="st-enc">UTF-8</span>
</footer>
