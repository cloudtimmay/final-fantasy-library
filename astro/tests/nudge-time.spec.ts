import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { computeDayTimes, nudgeEarlier, nudgeLater, moveGroupEarlier, moveGroupLater, gatherStops, moveLaterInTime, type PlanDay } from '../src/lib/itinerary-plan'
import { openInMapsUrl, directionsUrl } from '../src/lib/shop-maps'
import { planDocIdFor } from '../src/lib/trip-plans'

// −10 min / +10 min in a stop's sheet (itinerary-plan.ts nudgeEarlier / nudgeLater), ▲ ▼ −10 +10
// for a group of selected stops (moveGroupEarlier / moveGroupLater), "Leave at is before you
// arrive" with "Clear leave at", and the sheet's "🗺️ Open in Maps" / "🧭 Directions".
// The real 5 December 2026 day (tests/plan-samples/dec5-2026-kk.json): Krispy Kreme (stop 13) after
// Don Quijote Ikebukuro (stop 12, 17:53–18:23), with a leave time (18:48) before you can get there.
const SAMPLE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'plan-samples', 'dec5-2026-kk.json'), 'utf8'))
const AKIBA = { lat: 35.698, lng: 139.7731 }
const SHOPS = new Map<string, any>(SAMPLE.shops.map((s: any) => [s._id, s]))
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const c = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const nameOf = (s: any) => SHOPS.get(s.shopId)?.shopName || s.name
const realDay = (): PlanDay => ({ day: '2026-12-05', date: '5. des (lør)', area: '', note: '', ...JSON.parse(JSON.stringify(SAMPLE.day)) } as any)
const sched = (d: PlanDay, shops = SHOPS) => computeDayTimes(d, AKIBA, shops).sched
const KK = 12, DQ = 11
const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.698, lng: 139.7731, dur: 60, ...extra })
const day = (stops: any[], startTime = '10:00'): PlanDay => ({ day: '2026-12-05', date: '5. des', area: '', note: '', startTime, stops } as any)
const NONE = new Map<string, any>()

test.describe('the real Krispy Kreme case', () => {
  test('as saved: Don Quijote 17:53–18:23, then Krispy Kreme with a leave time before you get there (zero length)', () => {
    const d = realDay()
    expect(nameOf(d.stops[DQ])).toMatch(/Don Quijote Ikebukuro/)
    expect(nameOf(d.stops[KK])).toMatch(/Krispy Kreme/)
    const x = sched(d)
    expect([c(x.stops[DQ].start), c(x.stops[DQ].end)]).toEqual(['17:53', '18:23'])
    expect(x.stops[KK].arrivesAfterLeave).toBe(t('18:48'))
    expect(x.stops[KK].end).toBe(x.stops[KK].start) // zero length
  })

  test('−10 on Krispy Kreme: no soft time of its own, so Don Quijote is 10 min shorter; the order stays; +10 puts it back', () => {
    const d = realDay()
    const order = d.stops.map(nameOf)
    const before = sched(d).stops[KK].arrival
    expect(nudgeEarlier(d, KK, AKIBA, SHOPS)).toEqual({ ok: true })
    expect(d.stops.map(nameOf)).toEqual(order) // never swapped with Don Quijote
    expect(d.stops[DQ].dur).toBe(20)
    const x = sched(d)
    expect(x.stops[KK].arrival).toBe(before - 10)
    expect([c(x.stops[DQ].start), c(x.stops[DQ].end)]).toEqual(['17:53', '18:13'])
    // +10: a soft time 10 min after its start (its leave time moves with it).
    const start = x.stops[KK].start
    expect(nudgeLater(d, KK, AKIBA, SHOPS)).toEqual({ ok: true })
    expect(d.stops[KK].notBefore).toBe(c(start + 10))
    expect(d.stops[KK].leaveAt).toBe('18:58')
    // −10 now reduces that soft time first (gone at its natural time); Don Quijote is untouched.
    expect(nudgeEarlier(d, KK, AKIBA, SHOPS)).toEqual({ ok: true })
    expect(d.stops[KK].notBefore).toBeUndefined()
    expect(d.stops[KK].leaveAt).toBe('18:48')
    expect(d.stops[DQ].dur).toBe(20)
  })

  test('Harry Potter and ONE PIECE Harajuku down together: they keep their order and move later as one', () => {
    const d = realDay()
    const x0 = sched(d)
    const hp = d.stops.findIndex((s) => /Harry Potter Shop Harajuku/.test(nameOf(s)))
    const group = [hp, hp + 1]
    expect(group.map((i) => nameOf(d.stops[i]))).toEqual(['Harry Potter Shop Harajuku', 'ONE PIECE MUGIWARA STORE HARAJUKU'])
    const length = x0.stops[hp + 1].end - x0.stops[hp].start
    expect(moveGroupLater(d, group, AKIBA, SHOPS)).toEqual(group) // the day's end: later by its length
    const x = sched(d)
    expect(x.stops[hp].start).toBe(x0.stops[hp].start + length)
    expect(x.stops[hp + 1].start - x.stops[hp].start).toBe(x0.stops[hp + 1].start - x0.stops[hp].start) // together
    // ▲: back to where they were.
    expect(moveGroupEarlier(d, group, AKIBA, SHOPS)).toEqual(group)
    expect(d.stops[hp].notBefore).toBeUndefined()
    expect(sched(d).stops[hp].start).toBe(x0.stops[hp].start)
  })
})

test.describe('−10 / +10 (lib/itinerary-plan.ts)', () => {
  test('−10 shortens the stop before (its leave time when it has one)', () => {
    const d = day([stop('A', { leaveAt: '11:30' }), stop('B')])
    const b0 = sched(d, NONE).stops[1].start
    expect(nudgeEarlier(d, 1, AKIBA, NONE)).toEqual({ ok: true })
    expect(d.stops[0].leaveAt).toBe('11:20')
    expect(sched(d, NONE).stops[1].start).toBe(b0 - 10)
  })

  test('−10 is refused, and nothing changes: the stop before has a fixed time, a train leg here, under 10 min, the first stop, a fixed stop', () => {
    const cases: [PlanDay, number, string][] = [
      [day([stop('Lunch', { fixedTime: '10:30' }), stop('B')]), 1, 'Lunch has a fixed time (10:30), so it can\'t be shortened.'],
      [day([stop('A'), stop('B', { train: { legs: [{ line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara Station', departure: '11:30', platform: '', toStation: 'Ueno Station', arrival: '11:35' }], walkToStationMin: 5 } })]), 1, 'The trip here is a planned train, so shortening A doesn\'t move B.'],
      [day([stop('Short', { dur: 15 }), stop('B')]), 1, 'Short would be shorter than 10 min.'],
      [day([stop('First'), stop('B')]), 0, 'First is the first stop — start the day earlier instead.'],
      [day([stop('A'), stop('Show', { fixedTime: '14:00' })]), 1, 'Show has a fixed time (14:00) — change the time instead.'],
    ]
    for (const [d, idx, message] of cases) {
      const before = JSON.stringify(d.stops)
      expect(nudgeEarlier(d, idx, AKIBA, NONE)).toEqual({ ok: false, message })
      expect(JSON.stringify(d.stops)).toBe(before)
    }
    // A soft time that holds nothing back is removed, and the stop before shortened — but when that
    // can't be done either, the soft time stays too.
    const d = day([stop('Lunch', { fixedTime: '10:30' }), stop('B', { notBefore: '09:00' })])
    expect(nudgeEarlier(d, 1, AKIBA, NONE).ok).toBe(false)
    expect(d.stops[1].notBefore).toBe('09:00')
  })

  test('+10 on the day\'s last stop, and ▼ on it, move it later (▼ by its length)', () => {
    const d = day([stop('A'), stop('B')])
    const b0 = sched(d, NONE).stops[1].start
    expect(nudgeLater(d, 1, AKIBA, NONE)).toEqual({ ok: true })
    expect(sched(d, NONE).stops[1].start).toBe(b0 + 10)
    expect(moveLaterInTime(d, 1, AKIBA, NONE)).toBe('later')
    expect(sched(d, NONE).stops[1].start).toBe(b0 + 70)
  })
})

test.describe('a group of selected stops (lib/itinerary-plan.ts)', () => {
  const names = (d: PlanDay) => d.stops.map((s) => s.name)

  test('gathered where the first selected one is, in their order; ▲ / ▼ swap the group with the stop before / after it', () => {
    const d = day(['A', 'B', 'C', 'D', 'E'].map((n) => stop(n)))
    expect(gatherStops(d, [3, 1])).toEqual([1, 2])
    expect(names(d)).toEqual(['A', 'B', 'D', 'C', 'E'])
    expect(moveGroupEarlier(d, [1, 2], AKIBA, NONE)).toEqual([0, 1])
    expect(names(d)).toEqual(['B', 'D', 'A', 'C', 'E'])
    expect(moveGroupEarlier(d, [0, 1], AKIBA, NONE)).toBeNull() // first, and nothing holds it back
    expect(moveGroupLater(d, [0, 1], AKIBA, NONE)).toEqual([1, 2])
    expect(names(d)).toEqual(['A', 'B', 'D', 'C', 'E'])
  })

  test('▼ into free time before an anchor: later by the group\'s length (or the free time); ▲ back; −10 / +10 on its first stop', () => {
    const d = day([stop('G1', { dur: 30 }), stop('G2', { dur: 30 }), stop('Dinner', { fixedTime: '15:00' })])
    const x0 = sched(d, NONE)
    expect(moveGroupLater(d, [0, 1], AKIBA, NONE)).toEqual([0, 1])
    expect(names(d)).toEqual(['G1', 'G2', 'Dinner'])
    let x = sched(d, NONE)
    expect(x.stops[0].start).toBe(x0.stops[0].start + (x0.stops[1].end - x0.stops[0].start))
    expect(x.stops[1].start - x.stops[0].start).toBe(x0.stops[1].start - x0.stops[0].start)
    expect(moveGroupEarlier(d, [0, 1], AKIBA, NONE)).toEqual([0, 1])
    expect(sched(d, NONE).stops[0].start).toBe(x0.stops[0].start)
    // +10 on the group: its first stop.
    expect(nudgeLater(d, 0, AKIBA, NONE)).toEqual({ ok: true })
    x = sched(d, NONE)
    expect([x.stops[0].start, x.stops[1].start]).toEqual([x0.stops[0].start + 10, x0.stops[1].start + 10])
  })
})

test.describe('"🗺️ Open in Maps" and "🧭 Directions" (lib/shop-maps.ts)', () => {
  test('the place by name and address when known, else its coordinates; directions by transit from where you are', () => {
    const shop = { name: 'Krispy Kreme Doughnuts Meiji jingumae', address: '1-14-27 Jingumae, Shibuya, Tokyo', lat: 35.6705, lng: 139.7027 }
    expect(openInMapsUrl(shop)).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Krispy Kreme Doughnuts Meiji jingumae, 1-14-27 Jingumae, Shibuya, Tokyo')}`)
    expect(directionsUrl(shop)).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Krispy Kreme Doughnuts Meiji jingumae, 1-14-27 Jingumae, Shibuya, Tokyo')}&travelmode=transit`)
    const own = { name: 'Own Stop', lat: 35.69, lng: 139.7 }
    expect(openInMapsUrl(own)).toBe('https://www.google.com/maps/search/?api=1&query=35.69%2C139.7')
    expect(directionsUrl(own)).toBe('https://www.google.com/maps/dir/?api=1&destination=35.69%2C139.7&travelmode=transit')
    expect(directionsUrl(own)).not.toContain('origin=') // from your current location
    // A Maps link pasted as the address isn't a destination: the coordinates are used.
    expect(directionsUrl({ ...own, address: 'https://maps.app.goo.gl/abc' })).toBe('https://www.google.com/maps/dir/?api=1&destination=35.69%2C139.7&travelmode=transit')
  })
})

// A test trip in 2027 with one day planned (its own plan document); saves are mocked.
async function openPlan(page: any, sanity: any, trackDoc: (id: string) => void, stops: any[], startTime = '10:00') {
  const tag = Date.now()
  const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Nudge ${tag}`), firstTokyoDay: '2027-03-02', lastTokyoDay: '2027-03-03' })
  trackDoc(trip._id)
  const plan = await sanity.createOrReplace({ _id: planDocIdFor({ ...trip }), _type: 'itineraryState', data: JSON.stringify({ v: 2, days: { '2027-03-02': { startTime, stops } } }), updatedAt: new Date().toISOString(), trip: { _type: 'reference', _ref: trip._id, _weak: true } })
  trackDoc(plan._id)
  const saves: any[] = []
  await page.route('**/api/itinerary-save', async (route: any) => {
    saves.push(JSON.parse(route.request().postDataJSON().data))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto(`/itinerary?trip=${trip._id}`)
  await page.locator('.itl-tab', { hasText: '2. mar' }).click()
  const last = () => saves[saves.length - 1].days['2027-03-02'].stops
  return { saves, last }
}
const blockOf = (page: any, n: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: n }) })

test.describe('/itinerary: −10 / +10, a group, "Clear leave at" and the map links', () => {
  test('the sheet: −10 shortens the stop before, +10 sets a soft time; a refusal says why and saves nothing; the two map links', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const { saves, last } = await openPlan(page, sanity, trackDoc, [stop('Lunch', { fixedTime: '10:30', dur: 60 }), stop('Shop A', { dur: 45 }), stop('Shop B', { dur: 30 })])
    await blockOf(page, 'Shop B').locator('.itl-name').click()
    await page.locator('#itl-ed-earlier').click()
    await expect.poll(() => saves.length && last()[1].dur).toBe(35)
    await page.locator('#itl-ed-later').click()
    await expect.poll(() => last()[2].notBefore).toBeTruthy()
    // Shop A: the stop before it (Lunch) has a fixed time — refused, nothing saved.
    await page.locator('#itl-detail-close').click()
    await blockOf(page, 'Shop A').locator('.itl-name').click()
    const n = saves.length
    await page.locator('#itl-ed-earlier').click()
    await expect(page.locator('#itl-ed-nudge-msg')).toHaveText('Lunch has a fixed time (10:30), so it can\'t be shortened.')
    expect(saves.length).toBe(n)
    // The map links of a stop with coordinates but no linked shop.
    await expect(page.locator('#itl-ed-gmaps')).toHaveText('🗺️ Open in Maps')
    await expect(page.locator('#itl-ed-gmaps')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=35.698%2C139.7731')
    await expect(page.locator('#itl-ed-directions')).toHaveText('🧭 Directions')
    await expect(page.locator('#itl-ed-directions')).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=35.698%2C139.7731&travelmode=transit')
    await expect(page.locator('#itl-ed-directions')).toHaveAttribute('target', '_blank')
  })

  test('☑ Select stops: two stops ▼ together (still selected), −10 refused with a reason; "Clear leave at" on a leave time before you arrive', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const { saves, last } = await openPlan(page, sanity, trackDoc, [stop('One', { dur: 30 }), stop('Two', { dur: 30 }), stop('Three', { dur: 30 }), stop('Late', { dur: 30, leaveAt: '10:00' })])
    // The leave time before you get there.
    const late = blockOf(page, 'Late')
    await late.locator('.itl-name').click()
    await expect(page.locator('#itl-detail')).toContainText('⚠️ Leave at is before you arrive (10:00)')
    await page.locator('#itl-detail .itl-clear-leave').click()
    await expect.poll(() => saves.length && last()[3].leaveAt).toBeUndefined()
    await expect(page.locator('#itl-detail')).not.toContainText('Leave at is before you arrive')
    await page.locator('#itl-detail-close').click()
    // Select One and Two; ▼: swapped with Three as a group, still selected.
    await page.locator('#itl-select-btn').click()
    await blockOf(page, 'One').click()
    await blockOf(page, 'Two').click()
    await page.locator('#itl-select-down').click()
    await expect.poll(() => last().map((s: any) => s.name)).toEqual(['Three', 'One', 'Two', 'Late'])
    await expect(page.locator('.itl-block.itl-selected .itl-name')).toHaveText(['One', 'Two'])
    // ▲ back up.
    await page.locator('#itl-select-up').click()
    await expect.poll(() => last().map((s: any) => s.name)).toEqual(['One', 'Two', 'Three', 'Late'])
    // −10 on the group: its first stop is the day's first — refused, with the reason.
    await page.locator('#itl-select-earlier').click()
    await expect(page.locator('#itl-select-msg')).toHaveText('One is the first stop — start the day earlier instead.')
  })
})
