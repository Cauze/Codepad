<script lang="ts">
  import { dismissNote, notes } from './lib/notify.svelte';
</script>

<div id="notes" aria-live="polite">
  {#each notes as n (n.id)}
    <div class="note" class:err={n.kind === 'error'} role={n.kind === 'error' ? 'alert' : 'status'}>
      <span>{n.text}</span>
      <button aria-label="Dismiss" title="Dismiss" onclick={() => dismissNote(n.id)}>×</button>
    </div>
  {/each}
</div>
