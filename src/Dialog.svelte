<script lang="ts">
  import { tick } from 'svelte';
  import { closeDialog, dlg } from './lib/dialog.svelte';

  let box: HTMLDivElement;

  // Start on the primary button each time a question is asked.
  $effect(() => {
    void dlg.focusReq;
    if (dlg.open) {
      void tick().then(() => {
        const btns = [...box.querySelectorAll('button')];
        (btns.find((b) => b.classList.contains('primary')) ?? btns[0])?.focus();
      });
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDialog(null); return; }
    const move = e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey) ? 1 : e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 0;
    if (!move) return;
    e.preventDefault(); // keep focus inside the dialog
    const btns = [...box.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + move + btns.length) % btns.length]?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div id="dialog" hidden={!dlg.open} onmousedown={(e) => { if (e.target === e.currentTarget) closeDialog(null); }} onkeydown={onKeydown}>
  <div class="dlg-box" role="alertdialog" aria-modal="true" aria-label={dlg.title} bind:this={box}>
    <h2>{dlg.title}</h2>
    {#if dlg.message}<p>{dlg.message}</p>{/if}
    {#if dlg.items?.length}
      <ul>{#each dlg.items as it}<li>{it}</li>{/each}</ul>
    {/if}
    <div class="dlg-actions">
      {#each dlg.buttons as b (b.value)}
        <button class:primary={b.primary} class:danger={b.danger} onclick={() => closeDialog(b.value)}>{b.label}</button>
      {/each}
    </div>
  </div>
</div>
