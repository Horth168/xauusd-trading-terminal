import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW({ immediate: true });

/**
 * iOS home-screen apps with a translucent status bar sometimes report a viewport that is shorter than the
 * physical screen by the status-bar height, leaving an empty band under the tab bar. When that happens,
 * size the app to the real screen height instead.
 */
function fitScreen() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  const root = document.documentElement;
  if (!ios || !standalone) { root.style.removeProperty('--app-height'); return; }
  const portrait = window.innerHeight >= window.innerWidth;
  const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const h = Math.max(window.innerHeight, screenH);
  root.style.setProperty('--app-height', `${h}px`);
}
fitScreen();
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', () => setTimeout(fitScreen, 300));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
