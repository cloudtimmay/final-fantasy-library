// Service worker for offline access — registered from every page (see Base.astro).
// Bump this version string to force a fresh cache when you change cached files.
const CACHE_NAME = 'ff-offline-v2'

// How long a navigation waits for the network before falling back to cache (if there is
// one). If there's no cache, it keeps waiting on the network instead of giving up.
const NAV_TIMEOUT_MS = 5000

// Pages, pre-cached individually. Each one is fetched and checked before being stored —
// not just "response.ok" but also not redirected and actually HTML from our own origin.
// Without that check, an expired Cloudflare Access session (which responds to any of
// these URLs with a redirect, or a same-status login page, from a different origin or
// with a different content type) could get cached under one of these page URLs and be
// served back as if it were the real page, offline, indefinitely.
const PAGE_ASSETS = ['/offline', '/checklist', '/prices', '/spending']

// Static assets — same origin/ok/redirect checks, but they're never HTML so that check
// doesn't apply to them.
const STATIC_ASSETS = ['/html5-qrcode.min.js', '/favicon.svg']

// Same-origin, or one of the Google Fonts hosts we also fetch (see the `fetch` handler
// below) — those are intentionally still cached for offline use; they carry none of the
// Cloudflare Access risk the same-origin check below exists for, since nothing on our own
// origin's auth gate can respond on their behalf.
function isAllowedCacheOrigin(urlString) {
  try {
    const { origin, hostname } = new URL(urlString)
    return origin === self.location.origin || hostname.includes('fonts.googleapis.com') || hostname.includes('fonts.gstatic.com')
  } catch {
    return false
  }
}

function isSafeRuntimeResponse(res) {
  return !!res && res.ok && !res.redirected && isAllowedCacheOrigin(res.url)
}

async function precachePage(cache, path) {
  try {
    const req = new Request(path, { cache: 'reload' })
    const res = await fetch(req)
    if (!isSafeRuntimeResponse(res)) return
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return
    await cache.put(req, res)
  } catch {
    // A single page failing to precache (offline install, server hiccup, auth gate...)
    // must not fail the whole install — the rest of the cache is still useful.
  }
}

async function precacheStatic(cache, path) {
  try {
    const req = new Request(path, { cache: 'reload' })
    const res = await fetch(req)
    if (!isSafeRuntimeResponse(res)) return
    await cache.put(req, res)
  } catch {
    // Same as precachePage — isolated per asset.
  }
}

// On install: pre-cache the core files. skipWaiting() means a new version takes over as
// soon as it finishes installing, without waiting for every open tab of the old version
// to close first — see CLEANUP.md for why that trade-off is acceptable here and how to
// disable the service worker entirely if an update ever ships something bad.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        ...PAGE_ASSETS.map((p) => precachePage(cache, p)),
        ...STATIC_ASSETS.map((p) => precacheStatic(cache, p)),
      ])
    ).then(() => self.skipWaiting())
  )
})

// On activate: clean up old caches, then take control of already-open tabs immediately
// (clients.claim()) rather than only on their next navigation.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Navigations: network-first, but don't let a slow network hold the page forever. If the
// network hasn't answered within NAV_TIMEOUT_MS, serve the cached copy if there is one —
// the "saved copy" banner (Base.astro) will flag it as such. With no cache yet, there is
// nothing useful to fall back to, so keep waiting on the network rather than giving up.
function respondToNavigation(req) {
  return new Promise((resolve) => {
    let settled = false

    fetch(req)
      .then((res) => {
        // Clone synchronously, in this same tick — resolve(res) below hands the original
        // straight to the browser to stream as the navigation response, which can lock
        // its body before a clone requested after an await (e.g. inside caches.open()'s
        // own .then()) gets to run, throwing "Body is disturbed or locked".
        const copy = isSafeRuntimeResponse(res) ? res.clone() : null
        if (copy) {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        if (!settled) {
          settled = true
          resolve(res)
        }
      })
      .catch(() => {
        if (settled) return
        caches.match(req).then((cached) => {
          if (settled) return
          settled = true
          resolve(cached || caches.match('/offline').then((off) => off || new Response('Offline and not cached.', { status: 503, statusText: 'Offline' })))
        })
      })

    setTimeout(() => {
      if (settled) return
      caches.match(req).then((cached) => {
        if (settled || !cached) return // no cache yet — keep waiting on the network above.
        settled = true
        resolve(cached)
      })
    }, NAV_TIMEOUT_MS)
  })
}

// On fetch: network-first for everything else too, with the same safety checks applied
// to what gets cached. /api/ responses are never intercepted or cached at all — API data
// must always be live or fail outright, never silently stale.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  const isSameOrigin = url.origin === self.location.origin
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')
  if (!isSameOrigin && !isFont) return
  if (isSameOrigin && url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(respondToNavigation(req))
    return
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (isSafeRuntimeResponse(res)) {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || new Response('Offline and not cached.', { status: 503, statusText: 'Offline' }))
      )
  )
})
