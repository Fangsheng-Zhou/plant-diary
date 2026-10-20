// Plant Diary service worker: makes the app open offline and installs updates.
// Bump VERSION whenever any app file changes, so phones pick up the update.
const VERSION = 'plant-diary-1.0.0';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './vendor/supabase.js',
  './js/app.js',
  './js/config.js',
  './js/crypto.js',
  './js/model.js',
  './js/localdb.js',
  './js/images.js',
  './js/data.js',
  './js/backup-core.js',
  './js/backup.js',
  './js/theme.js',
  './js/icons.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only the app's own files. Database and photo requests always go to the network.
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first for the page itself, so updates show up; cached copy when offline.
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html')),
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});
