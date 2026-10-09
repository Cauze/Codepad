import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { appState, saveState } from './config.svelte';

/*
 * Remembers the window's size, position and maximized state in state.json (physical pixels).
 * Restored before the window is first shown, so there's no jump. A saved position that no longer
 * lands on any monitor (unplugged screen, changed layout) is ignored and the window stays centred.
 */

const MIN_VISIBLE = 120; // px of the window that must overlap a monitor for the position to be trusted

export async function restoreWindow(): Promise<void> {
  const w = appState.window;
  if (!w) return;
  const win = getCurrentWindow();
  try {
    await win.setSize(new PhysicalSize(w.w, w.h));
    // The first size applied to a still-hidden frameless window comes out taller than asked
    // (the hidden caption is counted); asking again gives the exact size.
    const got = await win.innerSize();
    if (got.width !== w.w || got.height !== w.h) await win.setSize(new PhysicalSize(w.w, w.h));
    const mons = await availableMonitors();
    const fits = mons.some((m) => {
      const ox = Math.min(w.x + w.w, m.position.x + m.size.width) - Math.max(w.x, m.position.x);
      const oy = Math.min(w.y + w.h, m.position.y + m.size.height) - Math.max(w.y, m.position.y);
      return ox >= MIN_VISIBLE && oy >= MIN_VISIBLE;
    });
    if (fits) await win.setPosition(new PhysicalPosition(w.x, w.y));
    else await win.center();
    if (w.max) await win.maximize();
  } catch (e) { console.error(e); }
}

/** Start tracking changes. Call after the window is shown. */
export async function trackWindow(): Promise<void> {
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capture = async () => {
    try {
      if (await win.isMinimized()) return;
      const max = await win.isMaximized();
      if (max) { // keep the last normal bounds so un-maximizing comes back to them
        if (appState.window) appState.window.max = true;
        else { const p = await win.outerPosition(); const s = await win.innerSize(); appState.window = { x: p.x, y: p.y, w: s.width, h: s.height, max: true }; }
      } else {
        const p = await win.outerPosition();
        const s = await win.innerSize();
        appState.window = { x: p.x, y: p.y, w: s.width, h: s.height, max: false };
      }
      saveState();
    } catch { /* window is going away */ }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void capture(), 500); };
  await win.onMoved(soon);
  await win.onResized(soon);
}
