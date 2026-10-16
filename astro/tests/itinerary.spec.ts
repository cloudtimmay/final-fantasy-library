import { test, expect } from './fixtures'
import { computeTransitions, extractJpyTotal, haversineKm } from '../src/lib/itinerary-review-helpers'

// These exercise the pure computation itself directly — the only way to deterministically
// verify "the computed distances and gaps" without hitting the real Anthropic API, since
// mocking /api/itinerary-review at the route level (as the page-level tests below do)
// bypasses the endpoint's own code entirely, server-computed numbers included.
test.describe('itinerary-review-helpers: distance/gap/fare computation', () => {
  test('computes haversine distance and the gap in minutes between consecutive stops', () => {
    const stops = [
      { name: 'A', plannedTime: 600, durationMin: 60, lat: 35.6984, lng: 139.7731 }, // Akihabara
      { name: 'B', plannedTime: 700, durationMin: 30, lat: 35.6895, lng: 139.6917 }, // Shinjuku, ~8.5 km away
    ]
    const transitions = computeTransitions(stops)
    expect(transitions[0]).toBeNull()
    expect(transitions[1]).not.toBeNull()
    expect(transitions[1]!.distanceKm).toBeGreaterThan(5)
    expect(transitions[1]!.distanceKm).toBeLessThan(12)
    // 700 - (600 + 60) = 40 minutes between stop 1 ending and stop 2 starting.
    expect(transitions[1]!.gapMin).toBe(40)
  })

  test('returns null distance when either stop is missing coordinates', () => {
    const stops = [
      { name: 'A', plannedTime: 600, durationMin: 60, lat: null, lng: null },
      { name: 'B', plannedTime: 700, durationMin: 30, lat: 35.6895, lng: 139.6917 },
    ]
    const transitions = computeTransitions(stops)
    expect(transitions[1]!.distanceKm).toBeNull()
    expect(transitions[1]!.gapMin).toBe(40)
  })

  test('sums JPY fares mentioned in free-text notes', () => {
    expect(extractJpyTotal(['Take the train, ¥260 one way', null, 'Another leg ¥180'])).toBe(440)
    expect(extractJpyTotal([null, undefined])).toBe(0)
    expect(extractJpyTotal(['No fares mentioned here'])).toBe(0)
  })

  test('haversineKm matches a known distance (Akihabara to Shinjuku)', () => {
    const km = haversineKm({ lat: 35.6984, lng: 139.7731 }, { lat: 35.6895, lng: 139.6917 })
    expect(km).toBeGreaterThan(6)
    expect(km).toBeLessThan(9)
  })
})

test.describe('itinerary: "Check day" AI review', () => {
  test('sends per-stop timing and coordinates in order, and renders results against the correct stops', async ({ page }) => {
    await page.goto('/itinerary')
    const firstCard = page.locator('.day-card').first()
    // Generous timeout: the page defers its first render until an external Leaflet
    // script load settles (success or failure), which can take a moment.
    await expect(firstCard).toBeVisible({ timeout: 20000 })

    const stopNames = await firstCard.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    expect(stopNames.length).toBeGreaterThan(0)

    let capturedBody: any = null
    await page.route('**/api/itinerary-review', async (route) => {
      capturedBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          items: [
            { severity: 'warning', stopIndex: 0, message: 'This shop may be closed at the planned time.', suggestion: 'Move it later in the day.' },
            { severity: 'tip', stopIndex: null, message: 'Estimated total one-way train fare for the day: ¥440 (estimate, based on fares mentioned in your shop notes).', suggestion: null },
          ],
        }),
      })
    })

    await firstCard.locator('.day-check-btn').click()

    // The request carries exactly what the endpoint needs to compute distance/gap itself
    // (raw per-stop timing and coordinates), for every stop, in the displayed order.
    expect(capturedBody).toBeTruthy()
    expect(Array.isArray(capturedBody.stops)).toBe(true)
    expect(capturedBody.stops.length).toBe(stopNames.length)
    capturedBody.stops.forEach((s: any, i: number) => {
      expect(typeof s.name).toBe('string')
      expect(typeof s.plannedTime).toBe('number')
      expect(typeof s.durationMin).toBe('number')
      expect(s.name).toBe(stopNames[i])
    })

    const results = firstCard.locator('.day-check-results')
    await expect(results).toBeVisible()
    const items = results.locator('.ir-item')
    await expect(items).toHaveCount(2)

    const stopItem = items.filter({ hasText: 'This shop may be closed' })
    await expect(stopItem.locator('.ir-item-stop-link')).toHaveText(`Stop 1: ${stopNames[0]}`)
    await expect(stopItem).toContainText('Suggestion: Move it later in the day.')
    await expect(stopItem).toHaveClass(/ir-warning/)

    const dayItem = items.filter({ hasText: 'Estimated total one-way train fare' })
    await expect(dayItem.locator('.ir-item-stop-link')).toHaveCount(0) // whole-day item, not linked to a stop
    await expect(dayItem).toHaveClass(/ir-tip/)
  })

  test('shows "Looks good" for an empty result', async ({ page }) => {
    await page.goto('/itinerary')
    const firstCard = page.locator('.day-card').first()
    await expect(firstCard).toBeVisible({ timeout: 20000 })

    await page.route('**/api/itinerary-review', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) })
    })

    await firstCard.locator('.day-check-btn').click()
    const results = firstCard.locator('.day-check-results')
    await expect(results).toBeVisible()
    await expect(results).toContainText('Looks good')
  })

  test('never changes the plan', async ({ page }) => {
    await page.goto('/itinerary')
    const firstCard = page.locator('.day-card').first()
    await expect(firstCard).toBeVisible({ timeout: 20000 })

    const beforeStopNames = await firstCard.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    const beforeLocalStorage = await page.evaluate(() => localStorage.getItem('ff-itinerary-v12'))

    await page.route('**/api/itinerary-review', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [{ severity: 'tip', stopIndex: 0, message: 'A tip about stop 1.', suggestion: null }] }),
      })
    })

    await firstCard.locator('.day-check-btn').click()
    await expect(firstCard.locator('.day-check-results')).toBeVisible()

    const afterStopNames = await firstCard.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    const afterLocalStorage = await page.evaluate(() => localStorage.getItem('ff-itinerary-v12'))
    expect(afterStopNames).toEqual(beforeStopNames)
    expect(afterLocalStorage).toBe(beforeLocalStorage)
  })

  test('shows a network-error message without crashing', async ({ page }) => {
    await page.goto('/itinerary')
    const firstCard = page.locator('.day-card').first()
    await expect(firstCard).toBeVisible({ timeout: 20000 })

    await page.route('**/api/itinerary-review', async (route) => {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'API error: request failed' }) })
    })

    await firstCard.locator('.day-check-btn').click()
    const results = firstCard.locator('.day-check-results')
    await expect(results).toBeVisible()
    await expect(results).toContainText('API error: request failed')
    // The button recovers (re-enabled, label restored) instead of staying stuck.
    await expect(firstCard.locator('.day-check-btn')).toBeEnabled()
    await expect(firstCard.locator('.day-check-btn')).toHaveText('🔍 Check day')
  })
})
