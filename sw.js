/* Youtube Blue — service worker
   Network first (so your edits show up right away), cache as offline backup.
   Bump CACHE when you want installed copies to drop old files. */
const CACHE = 'yt-blue-v19';
const ASSETS = [
  './', 'index.html', 'design.html', 'analytics.html', 'scheduler.html', 'stories.html', 'voice.html', 'comic.html',
  'css/style.css',
  'js/core.js', 'js/home.js', 'js/design.js', 'js/analytics.js', 'js/scheduler.js', 'js/stories.js', 'js/comic-panels.js', 'js/vendor/mp4-muxer.min.js', 'js/comic-voice.js', 'js/comic.js', 'js/voice-grammar.js', 'js/voice.js', 'js/voice-library.js', 'js/voice-takes.js', 'js/voice-story.js',
  'manifest.webmanifest',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((a) => {
    const url = new URL(a, self.registration.scope);
    return fetch(url, { cache: 'no-cache' }).then((res) => { if (!res.ok) throw new Error(a + ' ' + res.status); return c.put(cacheKey(url), res); });
  }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first with a short wait: a weak signal falls back after ~3 s to the
// saved copy of exactly this version (so new pages never mix with old scripts);
// no network at all falls back to any saved copy, so the app always opens offline.
const NET_WAIT_MS = 3000;
function cacheKey(url) { const u = new URL(url); u.searchParams.delete('ts'); u.hash = ''; return u.href; }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Backend calls (the Cloudflare tunnel) are never touched or cached.
  if (/\.trycloudflare\.com$/i.test(url.hostname)) return;
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // The live backend address must always come straight from the network.
  if (url.pathname.endsWith('/backend-config.json')) return;
  if (req.headers.has('range')) return;          // media range requests go straight through

  // 'no-cache' revalidates with GitHub Pages every time, so a reload always gets
  // the newest site files. (Page navigations can't be re-created with options,
  // so fetch their URL.)
  const network = (req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' }))
    .then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(cacheKey(url), copy)).catch(() => {});
      }
      return res;
    });
  const exact = () => caches.match(cacheKey(url));
  const anyCopy = () => exact().then((hit) => hit || caches.match(req, { ignoreSearch: true }))
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match(new URL('index.html', self.registration.scope).href) : undefined));

  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const finish = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const timer = setTimeout(() => { exact().then(finish); }, NET_WAIT_MS);
    network.then((res) => { clearTimeout(timer); finish(res); }, () => {
      clearTimeout(timer);
      anyCopy().then((res) => { if (!settled) { settled = true; resolve(res || Response.error()); } });
    });
  }));
  e.waitUntil(network.catch(() => {}));   // keep refreshing the saved copy in the background
});

/* ---------- Voice Studio: finish story lines after the page closes ----------
   When Voice Studio is hidden, closed or swiped away, it hands the lines it
   hasn't sent yet to this worker. The worker POSTs them to the job server
   (in script order) and saves each job ID in IndexedDB, so the reopened page
   can collect the audio. Only the job server address the page passes in is
   called; nothing is cached. */
function ybDb() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('youtube-blue-voice', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch (err) { resolve(null); }
  });
}
function ybPut(db, key, value) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(value, key);
      t.oncomplete = t.onerror = t.onabort = () => resolve();
    } catch (err) { resolve(); }
  });
}
async function ybSubmitJobs(d) {
  const db = await ybDb();
  for (const job of d.jobs || []) {
    let rec;
    try {
      const res = await fetch(d.url, { method: 'POST', mode: 'cors', cache: 'no-store',
        headers: Object.assign({ 'Content-Type': 'application/json' }, d.headers || {}), body: JSON.stringify(job.body) });
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch (err) { /* not JSON */ }
      rec = res.ok && data && data.job_id ? { job_id: data.job_id, status: data.status || 'queued' }
        : { error: (data && (data.detail || data.error)) || ('HTTP ' + res.status), code: res.status, retry: res.status === 429 || res.status >= 500 };
    } catch (err) {
      rec = { error: String((err && err.message) || err), retry: true };
    }
    rec.at = Date.now();
    await ybPut(db, 'sent:' + d.runId + ':' + job.i, rec);
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((c) => c.postMessage({ type: 'yb-job-sent', runId: d.runId, i: job.i, rec }));
  }
}
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'yb-submit-jobs' && /^https?:\/\//.test(d.url || '')) e.waitUntil(ybSubmitJobs(d));
});
