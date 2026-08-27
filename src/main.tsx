import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { initNative } from './lib/native';
import { installGlobalLogHandlers, logger } from './lib/log';
import { isDesktop, isIos, isNativeApp } from './lib/save';
import './styles/global.css';

// First, before anything else can fail: from here on a crash leaves a trace on
// the device instead of vanishing into a console nobody can open on site.
installGlobalLogHandlers();

// A copy of the diary, taken by the app rather than by the user remembering to.
// After the handlers, so a failure in it is recorded like any other.
void import('./lib/autoBackup').then(({ scheduleAutoBackup }) => scheduleAutoBackup());

/*
 * Photographs stored as Blobs are converted to bytes once, a few seconds in.
 *
 * After the first render, and before the automatic backup, so the copy that
 * gets written is the converted one. See src/lib/photoData.ts for what it is
 * protecting the diary from.
 */
window.setTimeout(() => {
  void import('./lib/photoData').then(({ rewritePhotosAsBytes }) => rewritePhotosAsBytes());
}, 2500);

/*
 * The daily reminder is laid again on launch, and again when the app is put
 * away.
 *
 * Both matter. On launch the fortnight of notifications is topped back up;
 * on the way out, today's is dropped if the day has been written since it was
 * scheduled — which is the difference between a reminder and a bell that rings
 * at five whatever you did at three.
 */
function layReminders(): void {
  void (async () => {
    const [{ scheduleReminders, canRemind }, { currentStrings }] = await Promise.all([
      import('./lib/reminder'),
      import('./i18n/useLanguage'),
    ]);
    if (!canRemind()) return;
    const t = currentStrings();
    await scheduleReminders(t.reminderBody, t.appName);
  })();
}

window.setTimeout(layReminders, 3500);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') layReminders();
});

const log = logger('app');
log.info('started', {
  shell: isDesktop() ? 'mac' : isNativeApp() ? 'ios-app' : isIos() ? 'ios-web' : 'web',
  display: window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
});

// The native shells already ship the built files; a service worker there would
// only add a second, redundant cache in front of them.
if (!isNativeApp() && !window.yoman) {
  registerSW({
    immediate: true,
    onRegisteredSW: () => log.debug('service worker registered'),
    onRegisterError: (error) => log.warn('service worker failed to register', error),
  });
}

initNative();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
