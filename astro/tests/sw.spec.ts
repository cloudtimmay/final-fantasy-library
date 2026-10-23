import { test, expect } from './fixtures'

// Overrides playwright.config.ts's default 'block' — these tests are specifically about
// real service worker behavior, so they need it actually running.
test.use({ serviceWorkers: 'allow' })

test.describe('service worker', () => {
  test('registers from a page other than /offline', async ({ page }) => {
    await page.goto('/add-menu')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

    const scriptURL = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || null)
    expect(scriptURL).toMatch(/\/sw\.js$/)
  })

  test('precaches /checklist during install so it loads offline without ever having been visited', async ({
    page,
    context,
  }) => {
    await page.goto('/add-menu')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

    await context.setOffline(true)
    await page.goto('/checklist')
    await expect(page.getByRole('heading', { level: 1, name: 'Airport checklist', exact: true })).toBeVisible()
    await context.setOffline(false)
  })

  test('does not cache a redirected response', async ({ page }) => {
    await page.goto('/add-menu')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

    // /albums/<unknown id> is a real same-origin redirect (Astro.redirect('/albums')) —
    // fetch() follows it and returns the final response with redirected: true, keyed
    // under the original request. That must never end up in the cache: an expired
    // Cloudflare Access session behaves the same way (a redirect away from the real
    // page), and caching the end result under the original URL would make that stick.
    const redirectPath = '/albums/this-id-does-not-exist-' + Date.now()
    await page.evaluate((path) => fetch(path, { redirect: 'follow' }), redirectPath)

    const cachedUnderOriginalPath = await page.evaluate(async (path) => {
      const keys = await caches.keys()
      for (const key of keys) {
        const cache = await caches.open(key)
        if (await cache.match(path)) return true
      }
      return false
    }, redirectPath)
    expect(cachedUnderOriginalPath).toBe(false)
  })

  test('never caches /api/ responses', async ({ page }) => {
    await page.goto('/add-menu')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

    const apiPath = '/api/check-duplicate?barcode=0000000000000'
    await page.evaluate((path) => fetch(path), apiPath)

    const cached = await page.evaluate(async (path) => {
      const keys = await caches.keys()
      for (const key of keys) {
        const cache = await caches.open(key)
        if (await cache.match(path)) return true
      }
      return false
    }, apiPath)
    expect(cached).toBe(false)
  })
})
