/* Youtube Blue — service worker
   Network first (so your edits show up right away), cache as offline backup.
   Bump CACHE when you want installed copies to drop old files. */
const CACHE = 'yt-blue-v3';
const ASSETS = [
  './', 'index.html', 'design.html', 'analytics.html', 'stories.html', 'voice.html',
  'css/style.css',
  'js/core.js', 'js/home.js', 'js/design.js', 'js/analytics.js', 'js/stories.js', 'js/voice.js',
  'manifest.webmanifest',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Backend calls (the Cloudflare tunnel) are never touched or cached.
  if (/\.trycloudflare\.com$/i.test(url.hostname)) return;
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // The live backend address must always come straight from the network.
  if (url.pathname.endsWith('/backend-config.json')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
