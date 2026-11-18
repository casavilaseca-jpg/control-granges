const CACHE = 'granges-v3'
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)))
  self.skipWaiting()
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
  self.clients.claim()
})
self.addEventListener('fetch', e => {
  const req = e.request
  // HTML / navegació: NETWORK-FIRST → sempre la darrera versió desplegada.
  // Si no hi ha connexió, cau a la còpia desada (funciona offline).
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }
  // Resta (JS/CSS amb hash, imatges): cache-first (els noms canvien a cada build)
  e.respondWith(caches.match(req).then(cached => cached || fetch(req)))
})
