/**
 * Native shell start-up.
 *
 * Everything here is a no-op in a browser, so the same bundle serves the
 * website, the Mac app and the iPhone app.
 */
import { isNativeApp } from './save';
import { hostSync } from '../sync/client';

/** Marks the document so CSS can tell an installed app from a browser tab. */
function markStandalone(): void {
  const standalone =
    isNativeApp() ||
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag for a home-screen app.
    (navigator as { standalone?: boolean }).standalone === true;
  document.documentElement.dataset.standalone = String(standalone);
}

/** Keeps the iOS status bar legible against the navy top bar in both themes. */
async function syncStatusBar(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // The top bar is dark navy in either theme, so the clock stays white.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: '#0f2d4a' });
  } catch {
    // StatusBar is iOS/Android only; ignore anywhere else.
  }
}

/**
 * Asks the browser to keep the diary.
 *
 * This matters most on iOS, where storage for a web app can be cleared after a
 * stretch of not being opened. Granted persistence takes the diary out of that
 * eviction path. Safari grants it silently for an installed home-screen app;
 * the native shell does not need it at all.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (isNativeApp()) return true;
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function initNative(): void {
  if (typeof window === 'undefined') return;
  markStandalone();
  void syncStatusBar();
  void requestPersistentStorage();
  // The Mac app answers sync requests that arrive from the local network.
  hostSync();
}
