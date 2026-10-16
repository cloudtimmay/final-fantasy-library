import { test, expect } from './fixtures'

// Overrides playwright.config.ts's default 'block' — the "genuinely offline" test below
// needs a real, running service worker; the other tests in this file don't care either way.
test.use({ serviceWorkers: 'allow' })

// Dispatches a real 'pageshow' event with persisted set, the same event the inline
// script in Base.astro listens for to recheck a bfcache-restored page. Built via a
// plain Event + defineProperty rather than `new PageTransitionEvent(...)` so this works
// the same way across engines regardless of that constructor's availability.
async function dispatchPersistedPageshow(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })
    window.dispatchEvent(event)
  })
}

async function setRenderedAt(page: import('@playwright/test').Page, msAgo: number): Promise<void> {
  await page.evaluate((ago) => {
    document.body.setAttribute('data-rendered-at', String(Date.now() - ago))
  }, msAgo)
}

test.describe('saved copy banner', () => {
  test('a fresh page shows no banner', async ({ page }) => {
    await page.goto('/add-menu')
    await expect(page.locator('#saved-copy-banner')).toBeHidden()
  })

  test('a page older than 2 minutes shows the banner with a time, and Refresh reloads', async ({ page }) => {
    await page.goto('/add-menu');

    const TWO_MINUTES = 2 * 60 * 1000
    const renderedAtMs = Date.now() - (TWO_MINUTES + 10_000) // just over the threshold
    await setRenderedAt(page, TWO_MINUTES + 10_000)
    await dispatchPersistedPageshow(page)

    const banner = page.locator('#saved-copy-banner')
    await expect(banner).toBeVisible()
    // Formatted inside the page, not in Node — Node's and WebKit's Intl default-locale
    // resolution can disagree on things like AM/PM, so only the browser's own formatting
    // of the same timestamp is guaranteed to match what the banner itself renders.
    const expectedTime = await page.evaluate(
      (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      renderedAtMs
    )
    await expect(banner).toContainText(`Saved copy from ${expectedTime}. Data may be out of date.`)

    // A real reload: tag window with a marker, reload via the button, confirm the
    // marker is gone — a marker surviving would mean no actual navigation happened.
    // waitForEvent('load') (started before the click, so it can't miss it) is what
    // actually waits for a *new* navigation; waitForLoadState('load') would instead
    // resolve immediately against the already-loaded current document.
    await page.evaluate(() => {
      ;(window as any).__beforeReload = true
    })
    await Promise.all([page.waitForEvent('load'), page.locator('#saved-copy-refresh').click()])
    const markerAfterReload = await page.evaluate(() => (window as any).__beforeReload)
    expect(markerAfterReload).toBeUndefined()
  })

  test('a page older than 24 hours shows the banner with the date as well', async ({ page }) => {
    await page.goto('/add-menu')

    const TWENTY_FIVE_HOURS = 25 * 60 * 60 * 1000
    const renderedAtMs = Date.now() - TWENTY_FIVE_HOURS
    await setRenderedAt(page, TWENTY_FIVE_HOURS)
    await dispatchPersistedPageshow(page)

    const banner = page.locator('#saved-copy-banner')
    await expect(banner).toBeVisible()
    const expectedDateTime = await page.evaluate(
      (ms) =>
        new Date(ms).toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      renderedAtMs
    )
    await expect(banner).toContainText(`Saved copy from ${expectedDateTime}. Data may be out of date.`)
  })

  test('the banner hides again once the page is fresh', async ({ page }) => {
    await page.goto('/add-menu')
    await setRenderedAt(page, 10 * 60 * 1000)
    await dispatchPersistedPageshow(page)
    await expect(page.locator('#saved-copy-banner')).toBeVisible()

    await setRenderedAt(page, 0)
    await dispatchPersistedPageshow(page)
    await expect(page.locator('#saved-copy-banner')).toBeHidden()
  })

  // Real service worker, real offline emulation — no mocking. sw.js is registered from
  // every page (Base.astro) and is network-first with a cache fallback, re-caching every
  // successful online response. So: prime the cache with one specific timestamp while
  // online, go offline, reload, and the exact same timestamp coming back proves the page
  // was served from that cache, not a live render (which would be impossible anyway while
  // offline — the point is confirming *which* cached copy, and that the mechanism this
  // banner relies on genuinely works end to end).
  test('a genuinely offline, service-worker-cached page is correctly identified as a saved copy', async ({
    page,
    context,
  }) => {
    await page.goto('/offline')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })

    // Reload once more online so this exact response (with its own fresh
    // data-rendered-at) is what sw.js's fetch handler caches via cache.put.
    await page.reload({ waitUntil: 'load' })
    const primedRenderedAt = await page.locator('body').getAttribute('data-rendered-at')
    expect(primedRenderedAt).toBeTruthy()

    await context.setOffline(true)
    await page.reload({ waitUntil: 'load' })
    const offlineRenderedAt = await page.locator('body').getAttribute('data-rendered-at')
    expect(offlineRenderedAt).toBe(primedRenderedAt)

    // The banner itself doesn't yet think this is stale (it was cached moments ago) —
    // confirm the full feature end to end by aging it past the threshold from here.
    await setRenderedAt(page, 10 * 60 * 1000)
    await dispatchPersistedPageshow(page)
    await expect(page.locator('#saved-copy-banner')).toBeVisible()

    await context.setOffline(false)
  })
})
