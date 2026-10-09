<script lang="ts">
  import { changeSetting, settings } from './lib/config.svelte';
  import { canEdit, setLineEnding, status, store } from './lib/tabs.svelte';
  import { encodingMenu } from './lib/commands';
  import { setMdView } from './lib/markdown.svelte';
  import { encodingLabel } from './lib/encodings';
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
      title={settings.editable ? "This file can't be edited (binary, too large, or not cleanly decodable)" : 'Editing is off. Click to turn it on.'}
      onclick={() => { if (!settings.editable) changeSetting('editable', true); }}
    >Read-only</button>
  {/if}
  {#if store.active?.isMd}
    {@const tb = store.active}
    <span id="st-md" role="group" aria-label="Markdown view">
      <button class:on={tb.view === 'code'} onclick={() => void setMdView(tb, 'code')} title="Show the text only">Code</button>
      <button class:on={tb.view === 'split'} onclick={() => void setMdView(tb, 'split')} title="Text and preview side by side">Split</button>
      <button class:on={tb.view === 'preview'} onclick={() => void setMdView(tb, 'preview')} title="Show the rendered page (Ctrl+Shift+V)">Preview</button>
    </span>
  {/if}
  <span id="st-lang">{store.active?.lang ?? ''}</span>
  {#if store.active?.writable}
    <button
      id="st-eol"
      class="st-btn"
      disabled={!canEdit(store.active)}
      title={canEdit(store.active) ? `Line endings: click to switch to ${store.active.crlf ? 'LF' : 'CRLF'}` : 'Line endings'}
      onclick={() => store.active && setLineEnding(store.active, !store.active.crlf)}
    >{store.active.crlf ? 'CRLF' : 'LF'}</button>
  {/if}
  {#if store.active && !store.active.missing}
    <button id="st-enc" class="st-btn" title="Encoding: click to reopen or save with another" onclick={() => void encodingMenu()}>{encodingLabel(store.active.encoding, store.active.bom)}</button>
  {/if}
</footer>
