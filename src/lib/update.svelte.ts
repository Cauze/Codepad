import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appState, saveState, settings } from './config.svelte';

/*
 * Update flow. Nothing here ever installs on its own: a check only produces a notice, and the
 * download starts when the user presses the button (or runs "Install Update" from the palette).
 * The networking, checksum and file swapping all live in src-tauri/src/update.rs.
 */

export interface UpdateInfo {
  version: string;
  notesUrl: string;
  assetName: string;
  size: number;
  /** true: the exe is swapped in place; false: the installer is run */
  portable: boolean;
}

interface UpdateCheck {
  current: string;
  latest: UpdateInfo | null;
}

type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'restarting' | 'error';

export const upd: {
  phase: Phase;
  current: string;
  info: UpdateInfo | null;
  done: number;
  total: number;
  message: string;
  /** whether the notice is on screen */
  toast: boolean;
} = $state({ phase: 'idle', current: '', info: null, done: 0, total: 0, message: '', toast: false });

let hideTimer: ReturnType<typeof setTimeout> | undefined;

const busy = (): boolean => upd.phase === 'checking' || upd.phase === 'downloading' || upd.phase === 'restarting';
const errText = (e: unknown): string => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong.');

/** `manual` = the user asked: always give feedback. Otherwise (startup) stay quiet unless there is news. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (busy()) return;
  clearTimeout(hideTimer);
  upd.phase = 'checking';
  upd.message = '';
  upd.toast = manual;
  try {
    const r = await invoke<UpdateCheck>('check_update');
    upd.current = r.current;
    upd.info = r.latest;
    if (r.latest) {
      upd.phase = 'available';
      upd.toast = manual || appState.dismissedUpdate !== r.latest.version;
    } else {
      upd.phase = manual ? 'current' : 'idle';
      upd.toast = manual;
      if (manual) hideTimer = setTimeout(() => { if (upd.phase === 'current') { upd.toast = false; upd.phase = 'idle'; } }, 4000);
    }
  } catch (e) {
    upd.info = null;
    upd.phase = manual ? 'error' : 'idle';
    upd.message = errText(e);
    upd.toast = manual;
  }
}

export async function installUpdate(): Promise<void> {
  if (!upd.info || busy()) return;
  upd.phase = 'downloading';
  upd.done = 0;
  upd.total = upd.info.size;
  upd.message = '';
  upd.toast = true;
  try {
    await invoke('install_update'); // on success the app exits before this returns
  } catch (e) {
    upd.phase = 'error';
    upd.message = errText(e);
    upd.toast = true;
  }
}

/** "Later": hides the notice and remembers not to show this version's notice at launch again. */
export function dismissUpdate(): void {
  upd.toast = false;
  if (upd.phase === 'available' && upd.info) {
    appState.dismissedUpdate = upd.info.version;
    saveState();
  }
  if (upd.phase === 'current' || (upd.phase === 'error' && !upd.info)) upd.phase = 'idle';
}

export const showUpdateNotice = (): void => { upd.toast = true; };

export const openReleasePage = (url?: string): void => {
  void invoke('open_release_page', { url: url ?? null }).catch(console.error);
};

export async function initUpdates(): Promise<void> {
  await listen<{ done: number; total: number }>('update-progress', (e) => {
    upd.done = e.payload.done;
    upd.total = e.payload.total;
    if (upd.total > 0 && upd.done >= upd.total && upd.phase === 'downloading') upd.phase = 'restarting';
  });
  if (settings.checkForUpdates) setTimeout(() => void checkForUpdates(false), 3000);
}
