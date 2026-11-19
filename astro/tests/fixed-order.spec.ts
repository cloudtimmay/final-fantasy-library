import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { computeDayTimes, checkDayRequestBody, misplacedFixedFor, placeFixedStopByTime, moveStopToDay, moveStopsToDay, swapDays, type PlanDay } from '../src/lib/itinerary-plan'
import { reviewInputsFromBody, serverReviewItems } from '../src/lib/itinerary-review-helpers'
import { planDocIdFor } from '../src/lib/trip-plans'

// Fixed-time stops in the wrong order (itinerary-schedule.ts misplacedFixedStops, itinerary-plan.ts
// placeFixedStopByTime). The real 5 December 2026 day (tests/plan-samples/dec5-2026.json): after
// moving stops between days, Ōimachi Station Market (fixed 09:00) was stop 11, after ten Ikebukuro
// shops from 10:00 on — every one of them "Doesn't fit before 09:00" (once its stale 08:34 train no
// longer counts, tests/stale-train.spec.ts).
const SAMPLE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'plan-samples', 'dec5-2026.json'), 'utf8'))
const AKIBA = { lat: 35.698, lng: 139.7731 }
const SHOPS = new Map<string, any>(SAMPLE.shops.map((s: any) => [s._id, s]))
const PLACE = { base: () => AKIBA, shopById: SHOPS }
const nameOf = (s: any) => SHOPS.get(s.shopId)?.shopName || s.name
const realDay = (): PlanDay => ({ day: '2026-12-05', date: '5. des (lør)', area: '', note: '', ...JSON.parse(JSON.stringify(SAMPLE.broken)) } as any)
const MARKET = 'Ōimachi Station Market'

test.describe('fixed stops out of order: the real 5 December day', () => {
  test('found: the market (09:00) after ten stops planned later; every one of them "doesn\'t fit before 09:00"', () => {
    const day = realDay()
    expect(nameOf(day.stops[10])).toBe(MARKET)
    const { sched } = computeDayTimes(day, AKIBA, SHOPS)
    for (let k = 0; k < 10; k++) expect(sched.stops[k].doesntFit).toMatchObject({ anchorIndex: 10 })
    expect(misplacedFixedFor(day, AKIBA, SHOPS)).toEqual([{ index: 10, to: 0, laterBefore: 10 }])
  })

  test('the fix: the market to its time (position 1); the others keep their order; no stop is held to 09:00', () => {
    const day = realDay()
    const others = day.stops.filter((_, i) => i !== 10).map(nameOf)
    expect(placeFixedStopByTime(day, 10, AKIBA, SHOPS)).toBe(0)
    expect(day.stops.map(nameOf)).toEqual([MARKET, ...others])
    const { sched } = computeDayTimes(day, AKIBA, SHOPS)
    sched.stops.forEach((x) => expect(x.doesntFit?.anchorIndex).not.toBe(0))
    expect(sched.stops[0].staleTrain).toBeNull() // first again: its 08:34 train fits as planned
    expect(misplacedFixedFor(day, AKIBA, SHOPS)).toEqual([])
    // Already in place: nothing moves.
    expect(placeFixedStopByTime(day, 0, AKIBA, SHOPS)).toBe(0)
  })

  test('"Move to day…", Select stops and "Swap with day…" place a fixed stop by its time, not at the end', () => {
    // The market moved onto the Ikebukuro day from another day.
    const build = () => {
      const ikebukuro = realDay()
      const [market] = ikebukuro.stops.splice(10, 1)
      const other: PlanDay = { day: '2026-12-04', date: '4. des', area: '', note: '', startTime: '08:00', stops: [market, { name: 'Elsewhere', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 }] } as any
      return { ikebukuro, other }
    }
    let { ikebukuro, other } = build()
    moveStopToDay(other, 0, ikebukuro, PLACE)
    expect(nameOf(ikebukuro.stops[0])).toBe(MARKET)
    // Without placing (as before): at the end.
    ;({ ikebukuro, other } = build())
    moveStopToDay(other, 0, ikebukuro)
    expect(nameOf(ikebukuro.stops[ikebukuro.stops.length - 1])).toBe(MARKET)
    // Select stops: the market by its time, the other at the end.
    ;({ ikebukuro, other } = build())
    moveStopsToDay(other, [0, 1], ikebukuro, PLACE)
    expect(nameOf(ikebukuro.stops[0])).toBe(MARKET)
    expect(nameOf(ikebukuro.stops[ikebukuro.stops.length - 1])).toBe('Elsewhere')
    // Swap with day: the broken day swapped onto another date gets its fixed stop placed there.
    const broken = realDay()
    const empty: PlanDay = { day: '2026-12-06', date: '6. des', area: '', note: '', startTime: '07:25', stops: [] } as any
    swapDays(broken, empty, PLACE)
    expect(nameOf(empty.stops[0])).toBe(MARKET)
    expect(broken.stops).toEqual([])
  })

  test('Check day says it explicitly, with "Apply" moving it to position 1 (instead of "need N min more")', () => {
    const day = realDay()
    const inp = reviewInputsFromBody(checkDayRequestBody(day, { base: AKIBA, shopById: SHOPS, flight: null }))
    if ('error' in inp) throw new Error(inp.error)
    const items = serverReviewItems(inp)
    const item = items.find((i) => i.stopIndex === 10 && i.message.includes('planned later than its time'))!
    expect(item).toMatchObject({
      severity: 'warning',
      message: `${MARKET} (fixed 09:00) is stop 11, after 10 stops planned later than its time — so the stops before it can't fit before 09:00.`,
      suggestion: `Move ${MARKET} to its time (position 1).`,
      action: { type: 'move_position', stopIndex: 10, toIndex: 0 },
    })
    expect(items.some((i) => /need \d+ min more/.test(i.message) && i.message.includes(MARKET))).toBe(false)
  })
})

test.describe('/itinerary: "Move <stop> to its time" on the warning and in the sheet', () => {
  test('the one-tap fix on a "doesn\'t fit" warning moves it (toast with Undo), and the fixed stop\'s sheet offers it too', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const tag = Date.now()
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Fixed Order ${tag}`), firstTokyoDay: '2027-03-02', lastTokyoDay: '2027-03-03' })
    trackDoc(trip._id)
    const s = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.7295, lng: 139.7109, dur: 90, ...extra }) // long enough for the badges row
    // From 09:00, every shop is planned later than the market's 09:00 (as on the real day).
    const data = JSON.stringify({ v: 2, days: { '2027-03-02': { startTime: '09:00', stops: [s('Shop One'), s('Shop Two'), s('Shop Three'), s('Morning Market', { fixedTime: '09:00', dur: 120, lat: 35.6068, lng: 139.7343 })] } } })
    const plan = await sanity.createOrReplace({ _id: planDocIdFor({ ...trip }), _type: 'itineraryState', data, updatedAt: new Date().toISOString(), trip: { _type: 'reference', _ref: trip._id, _weak: true } })
    trackDoc(plan._id)
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    const restores: any[] = []
    await page.route('**/api/itinerary-history*', async (route) => {
      if (route.request().method() === 'POST') { restores.push(route.request().postDataJSON()); await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stop here"}' }); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, snapshots: [{ id: 'itinerarySnapshot-x-1', savedAt: new Date().toISOString(), changedDays: ['2027-03-02'], summary: '2 Mar' }] }) })
    })
    page.on('dialog', (d) => d.accept())
    await page.goto(`/itinerary?trip=${trip._id}`)
    await page.locator('.itl-tab', { hasText: '2. mar' }).click()
    const block = (n: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: n }) })
    // The fixed stop's own sheet: the warning and the fix.
    await block('Morning Market').locator('.itl-name').click()
    await expect(page.locator('#itl-detail')).toContainText('⚠️ Placed after 3 stops planned later than its 09:00')
    await expect(page.locator('#itl-detail .itl-place')).toHaveText('Move Morning Market to its time (position 1)')
    await page.locator('#itl-detail-close').click()
    // On the "doesn't fit" warning in a shop's sheet.
    await block('Shop Two').locator('.itl-name').click()
    await expect(page.locator('#itl-detail .itl-place')).toHaveText('Move Morning Market to its time (position 1)')
    await page.locator('#itl-detail-close').click()
    // On a "doesn't fit" warning of a stop before it.
    const fix = block('Shop Three').locator('.itl-place')
    await expect(fix).toHaveText('Move Morning Market to its time (position 1)')
    await fix.click()
    await expect(page.locator('#itl-act-toast')).toContainText('Moved Morning Market to its time (position 1).')
    await expect.poll(() => saves.length && saves[saves.length - 1].days['2027-03-02'].stops.map((x: any) => x.name)).toEqual(['Morning Market', 'Shop One', 'Shop Two', 'Shop Three'])
    await expect(page.locator('.itl-badge', { hasText: "Doesn't fit" })).toHaveCount(0)
    await expect(page.locator('.itl-block .itl-place')).toHaveCount(0)
    // ↩ Undo: through the plan's history.
    await page.locator('#itl-act-undo').click()
    await expect.poll(() => restores.length).toBe(1)
    expect(restores[0]).toMatchObject({ snapshotId: 'itinerarySnapshot-x-1' })
  })
})
