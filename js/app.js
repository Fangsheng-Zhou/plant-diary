import { init } from './data.js';
import { start, render } from './ui.js';

start();
init().then(() => render(true)).catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML =
    '<main class="page"><p>Plant Diary could not start. Check your connection and reopen the app.</p></main>';
});

// Offline support and automatic updates.
if ('serviceWorker' in navigator) {
  let reloaded = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload once when a new version takes over (not on the very first visit).
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update().catch(() => {});
    }).catch((e) => console.warn('Service worker not registered', e));
  });
}
