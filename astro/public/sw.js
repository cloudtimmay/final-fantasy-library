// Service worker for offline access to the /offline page.
// Bump this version string to force a fresh cache when you change cached files.
const CACHE_NAME = 'ff-offline-v1'

// The core files the offline page needs to load without a connection.
const CORE_ASSETS = [
  '/offline',
  '/html5-qrcode.min.js',
  '/favicon.svg',
]

// On install: pre-cache the core files.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  )
})

// On activate: clean up old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// On fetch: for navigations and cached assets, try network first, fall back to cache.
// This keeps content fresh when online but works when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Only handle same-origin requests plus the Google Fonts stylesheet/files.
  const isSameOrigin = url.origin === self.location.origin
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')
  if (!isSameOrigin && !isFont) return

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a fresh copy of successful responses for next time offline.
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() =>
        // Network failed (offline): serve from cache if we have it.
        caches.match(req).then((cached) => {
          if (cached) return cached
          // For a navigation with no cache, fall back to the cached /offline page.
          if (req.mode === 'navigate') return caches.match('/offline')
          return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' })
        })
      )
  )
})