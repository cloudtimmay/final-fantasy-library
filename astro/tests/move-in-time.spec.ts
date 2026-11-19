import { test, expect, testName } from './fixtures'
import { computeDayTimes, moveLaterInTime, moveEarlierInTime, applyRouteOrder, checkDayRequestBody, optimizerInput, legLeaveTime, type PlanDay } from '../src/lib/itinerary-plan'
import { reviewInputsFromBody, serverReviewItems, buildUserPrompt } from '../src/lib/itinerary-review-helpers'
import { optimizeRoute } from '../src/lib/route-optimizer'
import { planDocIdFor } from '../src/lib/trip-plans'

// ▲ / ▼ on the timeline move a stop in time, like a calendar (itinerary-plan.ts moveLaterInTime /
// moveEarlierInTime): into free time through a soft "⏳ Not before" time (PlanStop.notBefore), else a
// swap as before. The soft time is not an anchor (itinerary-schedule.ts).
const AKIBA = { lat: 35.698, lng: 139.7731 }
const SHOPS = new Map<string, any>()
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const c = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.698, lng: 139.7731, dur: 60, ...extra })
const day = (stops: any[], startTime = '10:00'): PlanDay => ({ day: '2026-12-05', date: '5. des', area: '', note: '', startTime, stops } as any)
const sched = (d: PlanDay) => computeDayTimes(d, AKIBA, SHOPS).sched

test.describe('▲ / ▼ in time (lib/itinerary-plan.ts)', () => {
  test('▼ into the free time before an anchor: later by its own length, then by what is left; the anchor stays', () => {
    const d = day([stop('A'), stop('Dinner', { fixedTime: '14:00' })])
    const before = sched(d)
    const a0 = before.stops[0]
    expect(before.stops[1].freeBefore!.minutes).toBeGreaterThan(120)
    expect(moveLaterInTime(d, 0, AKIBA, SHOPS)).toBe('later')
    expect(d.stops.map((s) => s.name)).toEqual(['A', 'Dinner'])
    expect(d.stops[0].notBefore).toBe(c(a0.start + 60))
    let x = sched(d)
    expect(x.stops[0].start).toBe(a0.start + 60)
    expect(x.stops[0].end - x.stops[0].start).toBe(60) // its length stays
    expect(x.stops[1].start).toBe(t('14:00'))
    // Again and again while there is free time: never past the anchor's buffer — the last step is
    // only what is left.
    for (let k = 0; k < 10 && sched(d).stops[1].freeBefore; k++) expect(moveLaterInTime(d, 0, AKIBA, SHOPS)).toBe('later')
    x = sched(d)
    expect(x.stops[1].freeBefore).toBeNull()
    expect(x.stops[0].doesntFit).toBeNull()
    expect(x.stops[0].leaveEarlierMin).toBeNull()
    expect(x.stops[1].start).toBe(t('14:00'))
    expect(d.stops.map((s) => s.name)).toEqual(['A', 'Dinner'])
    // With no free time left, ▼ swaps as before.
    expect(moveLaterInTime(d, 0, AKIBA, SHOPS)).toBe('swapped')
    expect(d.stops.map((s) => s.name)).toEqual(['Dinner', 'A'])
  })

  test('▼ with no free time after it swaps with the next stop, as before (no soft time)', () => {
    const d = day([stop('A'), stop('B'), stop('C')])
    expect(moveLaterInTime(d, 0, AKIBA, SHOPS)).toBe('swapped')
    expect(d.stops.map((s) => s.name)).toEqual(['B', 'A', 'C'])
    expect(d.stops.some((s) => s.notBefore)).toBe(false)
    // A fixed stop always swaps.
    const f = day([stop('Fixed', { fixedTime: '10:30' }), stop('Dinner', { fixedTime: '18:00' })])
    expect(moveLaterInTime(f, 0, AKIBA, SHOPS)).toBe('swapped')
    expect(f.stops[1].notBefore).toBeUndefined()
  })

  test('▲ moves a held-back stop earlier by its length and removes the soft time at its natural time; otherwise it swaps', () => {
    const d = day([stop('A'), stop('Dinner', { fixedTime: '14:00' })])
    const natural = sched(d).stops[0].start
    moveLaterInTime(d, 0, AKIBA, SHOPS)
    moveLaterInTime(d, 0, AKIBA, SHOPS)
    expect(d.stops[0].notBefore).toBe(c(natural + 120))
    expect(moveEarlierInTime(d, 0, AKIBA, SHOPS)).toBe('earlier')
    expect(d.stops[0].notBefore).toBe(c(natural + 60))
    expect(moveEarlierInTime(d, 0, AKIBA, SHOPS)).toBe('earlier')
    expect(d.stops[0].notBefore).toBeUndefined() // back at its natural time
    expect(sched(d).stops[0].start).toBe(natural)
    // Not held back (the first stop): nothing to do; a later one swaps up.
    expect(moveEarlierInTime(d, 0, AKIBA, SHOPS)).toBeNull()
    const e = day([stop('A'), stop('B', { notBefore: '09:00' })]) // a soft time that doesn't hold it
    expect(moveEarlierInTime(e, 1, AKIBA, SHOPS)).toBe('swapped')
    expect(e.stops.map((s) => s.name)).toEqual(['B', 'A'])
    expect(e.stops[0].notBefore).toBeUndefined() // it would only hold it back up there
  })

  test('the soft time never warns the stops before it, and it shows as free time before the trip', () => {
    // X runs to ~11:00, past Y's 10:30: Y just starts after X — no "doesn't fit", no "leave earlier".
    let d = day([stop('X'), stop('Y', { notBefore: '10:30' })])
    let x = sched(d)
    expect(x.stops[0].doesntFit).toBeNull()
    expect(x.stops[0].leaveEarlierMin).toBeNull()
    expect(x.segments).toEqual([])
    expect(x.stops[1].heldMin).toBeNull()
    expect(x.stops[1].start).toBeGreaterThanOrEqual(x.stops[0].end)
    // Y at 13:00: held there, with the time before the trip free; X untouched.
    d = day([stop('X'), stop('Y', { notBefore: '13:00' })])
    x = sched(d)
    expect(x.stops[1].start).toBe(t('13:00'))
    expect(x.stops[1].heldMin).toBeGreaterThan(0)
    expect(x.stops[1].freeBefore).toMatchObject({ from: x.stops[0].end, to: x.stops[1].travelStart })
    expect(x.stops[0].doesntFit).toBeNull()
    expect(x.stops[0].leaveEarlierMin).toBeNull()
    // The leg's "Google Maps (with time)" and the reminder leave when you set off for 13:00.
    expect(x.stops[0].departAt).toBe(x.stops[1].travelStart)
    expect(legLeaveTime(d, x, 1, 'stop', { baseStart: t('10:00') }).minutes).toBe(x.stops[1].travelStart)
    // A fixed stop ignores it.
    d = day([stop('X'), stop('F', { fixedTime: '12:00', notBefore: '15:00' })])
    expect(sched(d).stops[1].start).toBe(t('12:00'))
  })

  test('Check day and Suggest route use it; Suggest route keeps it on a stop it doesn\'t move', () => {
    const d = day([stop('X'), stop('Y', { notBefore: '13:00' })])
    const inp = reviewInputsFromBody(checkDayRequestBody(d, { base: AKIBA, shopById: SHOPS, flight: null }))
    if ('error' in inp) throw new Error(inp.error)
    expect(inp.scheduleInputs[1].notBefore).toBe(t('13:00'))
    expect(inp.daySchedule!.stops[1].start).toBe(t('13:00'))
    expect(serverReviewItems(inp).filter((i) => i.severity === 'warning')).toEqual([])
    const prompt = buildUserPrompt(null, null, '10:00', inp.stops, inp.notesByStop, inp.openingHoursByStop, null, inp.schedule, inp.daySchedule!.segments)
    expect(prompt).toContain('NOT BEFORE 13:00 (a soft time the owner chose')
    // Suggest route times Y at 13:00 (not counted as waiting).
    const opt = optimizerInput(d, { base: AKIBA, shopById: SHOPS })
    expect(opt.stops[1].notBefore).toBe(t('13:00'))
    const r = optimizeRoute(opt.stops, opt.startTime, opt.start, opt.weekday, opt.date)
    expect(r.order).toEqual([0, 1])
    // Applying an order: kept where the stop stays, dropped where it moves; the old stops untouched.
    const e = day([stop('A', { notBefore: '11:00' }), stop('B', { notBefore: '12:00' }), stop('C')])
    const old = e.stops.slice()
    applyRouteOrder(e, [1, 0, 2])
    expect(e.stops.map((s) => [s.name, s.notBefore])).toEqual([['B', undefined], ['A', undefined], ['C', undefined]])
    expect(old[0].notBefore).toBe('11:00') // Undo keeps it
    const f = day([stop('A', { notBefore: '11:00' }), stop('B')])
    applyRouteOrder(f, [0, 1])
    expect(f.stops[0].notBefore).toBe('11:00')
  })
})

// A test trip in 2027 with one day planned (its own plan document); saves are mocked.
async function planTrip(sanity: any, trackDoc: (id: string) => void, stops: any[]) {
  const tag = Date.now()
  const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Move In Time ${tag}`), firstTokyoDay: '2027-03-02', lastTokyoDay: '2027-03-03' })
  trackDoc(trip._id)
  const data = JSON.stringify({ v: 2, days: { '2027-03-02': { startTime: '10:00', stops } } })
  const plan = await sanity.createOrReplace({ _id: planDocIdFor({ ...trip }), _type: 'itineraryState', data, updatedAt: new Date().toISOString(), trip: { _type: 'reference', _ref: trip._id, _weak: true } })
  trackDoc(plan._id)
  return trip
}

test.describe('/itinerary: ▲ / ▼ in time on the timeline', () => {
  test('▼ Down moves it into the free time ("⏳ Not before" on the block and in the sheet, saved); ✕ clears it; ▲ Up moves it back', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const trip = await planTrip(sanity, trackDoc, [stop('Morning Shop'), stop('Dinner Place', { fixedTime: '14:00' })])
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto(`/itinerary?trip=${trip._id}`)
    await page.locator('.itl-tab', { hasText: '2. mar' }).click()
    const block = page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Morning Shop' }) })
    // The block's own time text, "HH:MM–HH:MM".
    const startOf = async () => t(/\d{2}:\d{2}/.exec((await block.locator('.itl-time').textContent()) || '')![0])
    const natural = await startOf()
    await block.locator('.itl-name').click()
    await expect(page.locator('#itl-ed-up')).toBeDisabled() // the first stop, not held back
    await page.locator('#itl-ed-down').click()
    const nb = c(natural + 60)
    await expect(page.locator('#itl-detail')).toContainText(`⏳ Not before ${nb}`)
    await expect(page.locator('#itl-ed-up')).toBeEnabled()
    await expect.poll(() => saves.length).toBeGreaterThan(0)
    expect(saves[saves.length - 1].days['2027-03-02'].stops[0]).toMatchObject({ name: 'Morning Shop', notBefore: nb })
    await expect(block.locator('.itl-nb')).toContainText(`⏳ Not before ${nb}`)
    expect(await startOf()).toBe(natural + 60)
    // ▲ Up: back to its natural time, the soft time gone.
    await page.locator('#itl-ed-up').click()
    await expect(page.locator('#itl-detail')).not.toContainText('Not before')
    await expect(block.locator('.itl-nb')).toHaveCount(0)
    expect(await startOf()).toBe(natural)
    // ▼ again, then ✕ on the block clears it.
    await page.locator('#itl-ed-down').click()
    await expect(block.locator('.itl-nb')).toBeVisible()
    await page.locator('#itl-detail-close').click()
    await block.locator('.itl-nb-clear').click()
    await expect(block.locator('.itl-nb')).toHaveCount(0)
    await expect.poll(() => saves[saves.length - 1].days['2027-03-02'].stops[0].notBefore).toBeUndefined()
    expect(await startOf()).toBe(natural)
  })
})

test.describe('/itinerary-list keeps the soft time', () => {
  test('a stop\'s notBefore survives an edit on the list (▼ there) and is saved as it was', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const trip = await planTrip(sanity, trackDoc, [stop('First Shop'), stop('Second Shop', { notBefore: '15:30' }), stop('Third Shop')])
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.locator('.mv.down[data-idx="0"]').first().click()
    await expect.poll(() => saves.length).toBeGreaterThan(0)
    const stops = saves[saves.length - 1].days['2027-03-02'].stops
    expect(stops.map((s: any) => s.name)).toEqual(['Second Shop', 'First Shop', 'Third Shop'])
    expect(stops[0].notBefore).toBe('15:30')
  })
})
