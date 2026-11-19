import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { computeDayTimes, checkDayRequestBody, optimizerInput, type PlanDay } from '../src/lib/itinerary-plan'
import { scheduleDay, staleTrainMessage } from '../src/lib/itinerary-schedule'
import { reviewInputsFromBody, serverReviewItems } from '../src/lib/itinerary-review-helpers'
import { planDocIdFor } from '../src/lib/trip-plans'

// A stale train (itinerary-schedule.ts staleTrain): a train left on a leg it no longer fits. The real
// 5 December 2026 day (tests/plan-samples/dec5-2026.json, the plan's undo snapshot of 19 Nov 14:06
// UTC): Ōimachi Station Market (fixed 09:00) had been moved after ten Ikebukuro shops, still with
// the 08:34 Akihabara → Ōimachi train planned when it was the day's first stop — so every shop
// before it said "Doesn't fit before Ōimachi Station Market 08:34".
const SAMPLE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'plan-samples', 'dec5-2026.json'), 'utf8'))
const AKIBA = { lat: 35.698, lng: 139.7731 }
const SHOPS = new Map<string, any>(SAMPLE.shops.map((s: any) => [s._id, s]))
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const realDay = (): PlanDay => ({ day: '2026-12-05', date: '5. des (lør)', area: '', note: '', ...JSON.parse(JSON.stringify(SAMPLE.broken)) } as any)
const nameOf = (s: any) => SHOPS.get(s.shopId)?.shopName || s.name
const marketIndex = (day: PlanDay) => day.stops.findIndex((s) => /imachi/i.test(nameOf(s)))

test.describe('a stale train on the real 5 December day', () => {
  test('the cause: the market (with its 08:34 train) moved after the Ikebukuro shops; the train is stale, not an anchor', () => {
    const day = realDay()
    const m = marketIndex(day)
    expect(m).toBe(10)
    expect(day.stops[m].train!.legs[0]).toMatchObject({ departure: '08:34', fromStation: 'Akihabara Station', toStation: 'Ōimachi Station' })
    const { sched } = computeDayTimes(day, AKIBA, SHOPS)
    expect(sched.stops[m].staleTrain).toBe(t('08:34'))
    // The leg is the estimate, not the train.
    expect(sched.stops[m].travelIn.source).not.toBe('train')
    // No stop is held to 08:34 any more (what's left is the market's own 09:00 out of order).
    sched.stops.forEach((x) => expect(x.doesntFit?.anchorTime).not.toBe(t('08:34')))
    sched.segments.forEach((g) => expect(g.anchorTime).not.toBe(t('08:34')))
    // Only that train: the 15:34 train to Harajuku (19:00) still is the leg.
    const hp = day.stops.findIndex((s) => /Harry Potter Shop Harajuku/.test(nameOf(s)))
    expect(sched.stops[hp].staleTrain).toBeNull()
    expect(sched.stops[hp].travelIn.source).toBe('train')
  })

  test('the same train with the market first (where it was planned) is used as before', () => {
    const day = realDay()
    const [market] = day.stops.splice(marketIndex(day), 1)
    day.stops.unshift(market)
    const { sched } = computeDayTimes(day, AKIBA, SHOPS)
    expect(sched.stops[0].staleTrain).toBeNull()
    expect(sched.stops[0].travelIn.source).toBe('train')
  })

  test('Check day lists it (and tells the model the timetable doesn\'t use it); Suggest route doesn\'t keep it', () => {
    const day = realDay()
    const m = marketIndex(day)
    const inp = reviewInputsFromBody(checkDayRequestBody(day, { base: AKIBA, shopById: SHOPS, flight: null }))
    if ('error' in inp) throw new Error(inp.error)
    const items = serverReviewItems(inp)
    const stale = items.filter((i) => i.message.includes('no longer fits'))
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({ severity: 'warning', stopIndex: m, message: 'Ōimachi Station Market: This train (08:34) no longer fits here. Plan a new one or remove it.' })
    expect(items.some((i) => i.message.includes('08:34') && !i.message.includes('no longer fits'))).toBe(false)
    const opt = optimizerInput(day, { base: AKIBA, shopById: SHOPS })
    expect(opt.stops[m].train).toBeNull()
    expect(opt.stops[m].locked).toBe(false)
  })
})

test.describe('stale trains (itinerary-schedule.ts)', () => {
  const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, lat: 35.698, lng: 139.7731, durationMin: 60, fixedTime: null, arriveEarlyMin: null, manualTravelMin: null, noteTravelMin: null, ...extra })
  const train = { departure: t('11:00'), arrival: t('11:20'), walkToStationMin: 5 }

  test('a stop that only runs long before a train keeps it (doesn\'t fit, counted back from it); one already left after it doesn\'t', () => {
    // Reached at 10:00, but 90 min long: you could still leave in time — the train stays the anchor.
    let d = scheduleDay([stop('Long', { durationMin: 90 }), stop('By Train', { train })], t('10:00'), { lat: 35.698, lng: 139.7731 })
    expect(d.stops[1].staleTrain).toBeNull()
    expect(d.stops[0].leaveEarlierMin).toBeGreaterThan(0)
    // Reached only at 11:30: the 11:00 train is gone.
    d = scheduleDay([stop('Late', { durationMin: 30 }), stop('By Train', { train })], t('11:30'), { lat: 35.698, lng: 139.7731 })
    expect(d.stops[1].staleTrain).toBe(t('11:00'))
    expect(d.stops[0].leaveEarlierMin).toBeNull()
    expect(d.stops[0].doesntFit).toBeNull()
    // Already left at 11:10 ("Leaving now"), 5 min from the station: too late for 11:00.
    d = scheduleDay([stop('Left', { actualStart: t('10:00'), actualEnd: t('11:10') }), stop('By Train', { train })], t('10:00'), { lat: 35.698, lng: 139.7731 })
    expect(d.stops[1].staleTrain).toBe(t('11:00'))
    // The first leg never: a train from the base before the day's start sets when you leave.
    d = scheduleDay([stop('By Train', { train })], t('10:58'), { lat: 35.698, lng: 139.7731 })
    expect(d.stops[0].staleTrain).toBeNull()
    expect(d.stops[0].travelIn.source).toBe('train')
    expect(staleTrainMessage(t('08:34'))).toBe('This train (08:34) no longer fits here. Plan a new one or remove it.')
  })
})

test.describe('/itinerary: a stale train on the leg and in the sheet', () => {
  test('the warning on the leg and in the sheet; no "doesn\'t fit" for the stops before it', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const tag = Date.now()
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Stale Train ${tag}`), firstTokyoDay: '2027-03-02', lastTokyoDay: '2027-03-03' })
    trackDoc(trip._id)
    const s = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.698, lng: 139.7731, dur: 60, ...extra })
    const TRAIN = { legs: [{ line: 'Keihin-Tōhoku Line', train: 'local', fromStation: 'Akihabara Station', departure: '08:34', platform: '4', toStation: 'Ōimachi Station', arrival: '08:54' }], walkToStationMin: 5, walkFromStationMin: 3 }
    const data = JSON.stringify({ v: 2, days: { '2027-03-02': { startTime: '10:00', stops: [s('Shop One'), s('Shop Two'), s('Market', { lat: 35.6068, lng: 139.7343, train: TRAIN }), s('Shop Three')] } } })
    const plan = await sanity.createOrReplace({ _id: planDocIdFor({ ...trip }), _type: 'itineraryState', data, updatedAt: new Date().toISOString(), trip: { _type: 'reference', _ref: trip._id, _weak: true } })
    trackDoc(plan._id)
    await page.route('**/api/itinerary-save', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}&day=2027-03-02`)
    await page.locator('.itl-tab', { hasText: '2. mar' }).click()
    const market = page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Market' }) })
    await expect(market.locator('.itl-train-stale')).toHaveText('⚠️ This train (08:34) no longer fits here. Plan a new one or remove it.')
    await expect(page.locator('.itl-badge', { hasText: "Doesn't fit" })).toHaveCount(0)
    await market.locator('.itl-name').click()
    await expect(page.locator('#itl-detail')).toContainText('⚠️ This train (08:34) no longer fits here. Plan a new one or remove it.')
  })
})
