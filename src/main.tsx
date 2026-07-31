import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { initNative } from './lib/native';
import { isNativeApp } from './lib/save';
import './styles/global.css';

// The native shells already ship the built files; a service worker there would
// only add a second, redundant cache in front of them.
if (!isNativeApp() && !window.yoman) {
  registerSW({ immediate: true });
}

initNative();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
