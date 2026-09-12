/**
 * Native shell start-up.
 *
 * Everything here is a no-op in a browser, so the same bundle serves the
 * website, the Mac app and the iPhone app.
 */
import { isDesktop, isNativeApp } from './save';
import { hostSync } from '../sync/client';

/** Marks the document so CSS can tell an installed app from a browser tab. */
function markStandalone(): void {
  const standalone =
    isNativeApp() ||
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag for a home-screen app.
    (navigator as { standalone?: boolean }).standalone === true;
  document.documentElement.dataset.standalone = String(standalone);
  document.documentElement.dataset.desktop = String(isDesktop());
}

const STATUS_BAR_COLOUR = {
  light: '#f4f4f3',
  dark: '#191919',
  black: '#000000',
} as const;

/** Keeps the native status bar legible against the current neutral top bar. */
async function syncStatusBar(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const theme = document.documentElement.dataset.theme;
    const resolved = theme === 'dark' || theme === 'black' ? theme : 'light';
    // Capacitor names these for the bar background: Light produces dark
    // status-bar content, while Dark produces light content on iOS.
    await StatusBar.setStyle({ style: resolved === 'light' ? Style.Light : Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: STATUS_BAR_COLOUR[resolved] });
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
  if (isNativeApp()) {
    // Theme changes update data-theme on <html>. Keep the native strip joined
    // to the app instead of leaving the colour from launch above a new theme.
    new MutationObserver(() => void syncStatusBar()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
  void requestPersistentStorage();
  // The Mac app answers sync requests that arrive from the local network.
  hostSync();
}
