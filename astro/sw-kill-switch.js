// EMERGENCY KILL SWITCH — not active. See CLEANUP.md ("Service worker — nødbryter") for
// exactly how and when to deploy this file.
//
// Deployed in place of public/sw.js, this version deletes every cache this origin's
// service worker ever created, unregisters itself, and reloads every open tab that was
// still under its control — after one more deploy with the real sw.js restored, there is
// no service worker left anywhere for this origin.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  )
})

// No fetch handler at all — every request falls straight through to the network, exactly
// as if no service worker were installed.
