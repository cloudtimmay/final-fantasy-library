import { test, expect, testName } from './fixtures'
import { optimizeRoute, type OptimizerStop } from '../src/lib/route-optimizer'
import { checkHours, closedOnArrival } from '../src/lib/opening-hours'

// "🧭 Suggest route" on a full day (more stops than the exhaustive limit): the opening-hours
// heuristic (lib/route-optimizer.ts insertionOrder).
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }
const SATURDAY = 6 // 5 December 2026
// Around Akihabara: a few minutes' walk apart.
const at = (k: number) => ({ lat: 35.6985 + k * 0.0006, lng: 139.7705 + (k % 3) * 0.0006 })
const shop = (k: number, hours: string, durationMin = 60): OptimizerStop => ({ ...at(k), durationMin, fixedTime: null, openingHours: hours, note: null })
// A real-style day: a fixed dinner at 20:00 (second in the list — the old order kept it there,
// so only one shop could come before it), and eight shops with mixed hours.
const NAMES = ['Until 20 A', 'Dinner 20:00', 'Until 20 B', 'Until 19', 'Open 24 hours', 'Evening 18–23', 'Lunchtime 10–15', 'Early 10–13', 'Morning 09–12']
const DAY: OptimizerStop[] = [
  shop(0, '10:00-20:00'),
  { ...at(1), durationMin: 90, fixedTime: t('20:00'), openingHours: null, note: null },
  shop(2, '11:00-20:00'),
  shop(3, '12:00-19:00'),
  shop(4, 'Open 24 hours'),
  shop(5, '18:00-23:00', 45),
  shop(6, '10:00-15:00'),
  shop(7, '10:00-13:00', 45),
  shop(8, '09:00-12:00'), // closed by the time the day starts: can't fit
]

test.describe('Suggest route: opening hours (lib/route-optimizer.ts)', () => {
  test('a fixed 20:00 stop and eight shops: none placed after closing, the gap before 20:00 used, the unplaceable one listed', () => {
    const r = optimizeRoute(DAY, t('12:00'), BASE, SATURDAY, '2026-12-05')
    // The morning-only shop is listed, not placed closed (it goes last in the order).
    expect(r.unplaced).toEqual([{ index: 8, closes: t('12:00') }])
    expect(r.order).toHaveLength(9)
    expect(r.order[r.order.length - 1]).toBe(8)
    const placed = r.order.slice(0, -1)
    // Every placed shop is open for its whole visit (waiting for the opening counts as fine).
    placed.forEach((i, pos) => {
      if (DAY[i].fixedTime != null) return
      const start = r.suggested.times[pos]
      const c = checkHours(DAY[i].openingHours, SATURDAY, start, start + DAY[i].durationMin, '2026-12-05')
      expect(closedOnArrival(c) || c.kind === 'closes-during', `${NAMES[i]} at ${start}: ${c.kind}`).toBe(false)
    })
    // The dinner keeps its time, and the gap from 12:00 to 20:00 is filled: the shops that close by
    // 20:00 all come before it.
    const dinnerPos = placed.indexOf(1)
    expect(r.suggested.times[dinnerPos]).toBe(t('20:00'))
    for (const i of [0, 2, 3, 6, 7]) expect(placed.indexOf(i), NAMES[i]).toBeLessThan(dinnerPos)
    expect(dinnerPos).toBeGreaterThanOrEqual(5)
    // The early ones first: 10–13 must be the first stop of the day.
    expect(placed[0]).toBe(7)
    expect(r.improved).toBe(true)
  })

  test('the flight day: nothing placed after the time to leave for the airport', () => {
    const shops = [0, 2, 3, 4, 5, 6, 7].map((k) => shop(k, 'Open 24 hours'))
    const r = optimizeRoute(shops, t('10:00'), BASE, SATURDAY, '2026-12-05', t('14:00'))
    // About four hours: four 60-min visits fit; the others are listed.
    expect(r.unplaced.length).toBeGreaterThanOrEqual(3)
    const placedCount = r.order.length - r.unplaced.length
    const lastStart = r.suggested.times[placedCount - 1]
    expect(lastStart + 60).toBeLessThanOrEqual(t('14:00'))
  })
})

test.describe('/itinerary: Suggest route lists what couldn\'t fit', () => {
  test('"Couldn\'t fit: <stop> (closes 12:00)" in the preview; it isn\'t placed closed', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Hours Route Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate(({ day, names }) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[0].startTime = '12:00'
      itl.state[0].stops = day.map((s: any, i: number) => ({ name: names[i], hours: s.openingHours || '', tag: '', slot: '', lat: s.lat, lng: s.lng, dur: s.durationMin, ...(s.fixedTime != null ? { fixedTime: '20:00' } : {}) }))
      itl.render()
    }, { day: DAY, names: NAMES })
    await page.locator('#itl-route-btn').click()
    const panel = page.locator('#itl-route-results')
    await expect(panel.locator('.rt-unplaced')).toHaveText(["Couldn't fit: Morning 09–12 (closes 12:00)"])
    const suggested = await panel.locator('.rt-column').nth(1).locator('.rt-list-item').allTextContents()
    expect(suggested).toHaveLength(8)
    expect(suggested.some((s) => s.includes('Morning 09–12'))).toBe(false)
    expect(suggested.findIndex((s) => s.endsWith('Dinner 20:00'))).toBeGreaterThanOrEqual(5)
  })
})
