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
