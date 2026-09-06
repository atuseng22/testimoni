/* FDC service worker
   Halaman selalu diambil dari jaringan lebih dulu, supaya versi baru
   langsung terpakai begitu diunggah. Simpanan hanya jadi cadangan
   saat sinyal hilang. */

const CACHE = 'fdc-shell-v3';
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'perbarui') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  /* data pasar dan berita tidak pernah disimpan — selalu segar */
  if (url.origin !== location.origin) return;

  /* halaman aplikasi: jaringan dulu, simpanan hanya bila luring */
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r && r.ok) {
          const salinan = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, salinan)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
