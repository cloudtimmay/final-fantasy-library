import { test, expect } from './fixtures'
import { computeTransitions, extractJpyTotal, haversineKm } from '../src/lib/itinerary-review-helpers'
import { estimateTravelMinutes, extractNoteTravelMinutes, optimizeRoute, type OptimizerStop } from '../src/lib/route-optimizer'

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

test.describe('route-optimizer: travel time estimate', () => {
  test('estimates walking time under ~1 km and a train estimate at or beyond it', () => {
    const a = { lat: 35.0, lng: 139.0 }
    const near = { lat: 35.003, lng: 139.0 } // ~333 m
    const far = { lat: 35.02, lng: 139.0 } // ~2.22 km
    const walkMin = estimateTravelMinutes(a, near)
    expect(walkMin).toBeGreaterThanOrEqual(1)
    expect(walkMin).toBeLessThan(10)
    const trainMin = estimateTravelMinutes(a, far)
    expect(trainMin).toBeGreaterThan(10) // overhead alone is 10
  })

  test('prefers an explicit minutes value (e.g. from a shop note) over the distance estimate', () => {
    expect(estimateTravelMinutes({ lat: 35.0, lng: 139.0 }, { lat: 35.1, lng: 139.1 }, 25)).toBe(25)
  })

  test('returns 0 when either point is missing coordinates', () => {
    expect(estimateTravelMinutes({ lat: null, lng: null }, { lat: 35.0, lng: 139.0 })).toBe(0)
  })

  test('extracts a travel time in minutes from a shop note', () => {
    expect(extractNoteTravelMinutes('Take the Ginza line, about 25 min from Akihabara (¥180)')).toBe(25)
    expect(extractNoteTravelMinutes('No travel info here')).toBeNull()
    expect(extractNoteTravelMinutes(null)).toBeNull()
  })
})

test.describe('route-optimizer: optimizeRoute', () => {
  function stop(partial: Partial<OptimizerStop>): OptimizerStop {
    return { lat: null, lng: null, durationMin: 30, fixedTime: null, openingHours: null, note: null, ...partial }
  }

  test('finds the geographically sensible order for a small, obviously-scrambled day', () => {
    const start = { lat: 35.0, lng: 139.0 }
    const near = stop({ lat: 35.01, lng: 139.0 }) // ~1.11 km from start
    const mid = stop({ lat: 35.02, lng: 139.0 }) // ~1.11 km from `near`
    const far = stop({ lat: 35.03, lng: 139.0 }) // ~1.11 km from `mid`
    // Current order is a scramble: far, near, mid — visiting the farthest stop first means
    // doubling back, which costs more travel than the monotonic near -> mid -> far order.
    const result = optimizeRoute([far, near, mid], 480, start)
    expect(result.improved).toBe(true)
    expect(result.order).toEqual([1, 2, 0]) // near (idx 1), mid (idx 2), far (idx 0)
    expect(result.suggested.score).toBeLessThan(result.current.score)
  })

  test('keeps a fixed-time stop in its original position, reordering only the others', () => {
    const start = { lat: 35.0, lng: 139.0 }
    const far = stop({ lat: 35.03, lng: 139.0 })
    const fixed = stop({ lat: 35.01, lng: 139.0, fixedTime: 600 }) // pinned at 10:00
    const near = stop({ lat: 35.005, lng: 139.0 })
    const result = optimizeRoute([far, fixed, near], 480, start)
    expect(result.order[1]).toBe(1) // the fixed stop (original index 1) never leaves position 1
    expect(result.suggested.times[1]).toBe(600) // still visited at its pinned time
  })

  test('avoids an ordering that arrives at a shop while it is closed, when a better order exists', () => {
    const start = { lat: 35.0, lng: 139.0 }
    // Both stops sit essentially at the start location, isolating the effect to opening
    // hours rather than travel distance. A (long, always open) then B (opens at 11:00)
    // arrives at B well after opening; B then A arrives at B immediately at 08:00, closed.
    const a = stop({ lat: 35.0, lng: 139.0, durationMin: 200, openingHours: '08:00–22:00' })
    const b = stop({ lat: 35.0, lng: 139.0, durationMin: 60, openingHours: '11:00–20:00' })
    const result = optimizeRoute([b, a], 480, start) // current order: b first (bad)
    expect(result.current.closedCount).toBe(1)
    expect(result.suggested.closedCount).toBe(0)
    expect(result.order).toEqual([1, 0]) // a (idx 1) first, then b (idx 0)
    expect(result.improved).toBe(true)
  })

  test('falls back to the first stop as the start location when none is given, and says so', () => {
    const stops = [stop({ lat: 35.0, lng: 139.0 }), stop({ lat: 35.01, lng: 139.0 })]
    const result = optimizeRoute(stops, 480, null)
    expect(result.usedFirstStopAsStart).toBe(true)
  })

  test('reports no improvement when the current order is already best', () => {
    const start = { lat: 35.0, lng: 139.0 }
    const near = stop({ lat: 35.01, lng: 139.0 })
    const far = stop({ lat: 35.03, lng: 139.0 })
    const result = optimizeRoute([near, far], 480, start) // already the sensible order
    expect(result.improved).toBe(false)
    expect(result.order).toEqual([0, 1])
  })
})

test.describe('itinerary: "Suggest route"', () => {
  // Apply/Undo change the plan, and the page autosaves the plan to /api/itinerary-save —
  // the one shared itineraryState document. Answered here instead, so these tests never
  // write the dataset's real plan (and a parallel test reading /itinerary never sees the
  // injected "Far/Near" day).
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/itinerary-save', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    )
  })

  // Replaces day 0 with a small, deterministic, obviously-scrambled plan directly in the
  // page's own `state` (the inline script's top-level `let`, reachable from page.evaluate
  // since it shares the page's global scope) — the real shared itinerary data has no
  // guaranteed "improvable" day, so Apply/Undo need a controlled fixture to test reliably.
  async function injectScrambledDay(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
      // @ts-ignore - these are globals from the page's own inline script
      state[0] = {
        date: state[0].date,
        area: state[0].area,
        note: '',
        startTime: '08:00',
        stops: [
          // Far first, then Near — base is close to Near, so visiting Far first means
          // doubling back; near-then-far is clearly better.
          { name: 'Far', hours: '', tag: '', slot: '', lat: base.lat + 0.1, lng: base.lng },
          { name: 'Near', hours: '', tag: '', slot: '', lat: base.lat + 0.001, lng: base.lng },
        ],
      }
      // @ts-ignore
      render()
    })
  }

  test('shows the current and suggested order with a "saves X min" summary', async ({ page }) => {
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await injectScrambledDay(page)

    const firstCard = page.locator('.day-card').first()
    await firstCard.locator('.day-route-btn').click()

    const results = firstCard.locator('.day-route-results')
    await expect(results).toBeVisible()
    await expect(results.locator('.rt-summary')).toContainText('Saves')
    const columns = results.locator('.rt-column')
    await expect(columns).toHaveCount(2)
    await expect(columns.nth(0)).toContainText('Far')
    await expect(columns.nth(0)).toContainText('Near')
    await expect(columns.nth(1).locator('.rt-list-item').first()).toContainText('Near')
    await expect(columns.nth(1).locator('.rt-list-item').last()).toContainText('Far')
  })

  test('does not change the plan until Apply is pressed', async ({ page }) => {
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await injectScrambledDay(page)

    const firstCard = page.locator('.day-card').first()
    const stopNamesBefore = await firstCard.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    expect(stopNamesBefore).toEqual(['Far', 'Near'])

    await firstCard.locator('.day-route-btn').click()
    await expect(firstCard.locator('.day-route-results')).toBeVisible()

    const stopNamesAfter = await firstCard.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    expect(stopNamesAfter).toEqual(['Far', 'Near'])
  })

  test('Apply writes the suggested order into the plan, and Undo restores the previous one', async ({ page }) => {
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await injectScrambledDay(page)

    const firstCard = page.locator('.day-card').first()
    await firstCard.locator('.day-route-btn').click()
    await firstCard.locator('.rt-apply-btn').click()

    // render() rebuilds the whole card — re-locate it fresh after each state change.
    const afterApply = page.locator('.day-card').first()
    const namesAfterApply = await afterApply.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    expect(namesAfterApply).toEqual(['Near', 'Far'])
    await expect(afterApply.locator('.day-route-results')).toContainText('Route applied')

    await afterApply.locator('.rt-undo-btn').click()
    const afterUndo = page.locator('.day-card').first()
    const namesAfterUndo = await afterUndo.locator('.stop-list > li.stop[data-idx] .stop-name').allTextContents()
    expect(namesAfterUndo).toEqual(['Far', 'Near'])
  })
})
