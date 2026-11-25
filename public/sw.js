/*
 * PO Tracker service worker: lets the installed app start without a connection.
 * Network first for the app's own files (so updates show up at once), with the last good copy
 * as the offline fallback. Data never goes through here: SharePoint / Microsoft sign-in are on
 * other origins and are not touched, and PO data lives in the app's own offline database.
 */
const CACHE = 'po-tracker-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-1024.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Dev server internals (hot reload etc.) are never cached.
  if (url.pathname.startsWith('/_expo/') && !url.pathname.startsWith('/_expo/static/')) return;
  if (url.pathname.includes('hot') || url.search.includes('platform=web&dev=true')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req.mode === 'navigate' ? '/' : req)) ?? Response.error()),
  );
});
