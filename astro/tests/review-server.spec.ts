import { test, expect, testName } from './fixtures'
import { reviewInputsFromBody, serverReviewItems, alreadyListedText } from '../src/lib/itinerary-review-helpers'
import { checkDayRequestBody, computeDayTimes } from '../src/lib/itinerary-plan'

// Check day: the server finds every timing problem itself, from the same schedule as the timeline,
// and lists it first — whatever the AI says (here: nothing, the AI isn't called in tests).
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }
const CAFE = { name: 'Final Fantasy Eorzea Cafe', lat: 35.70095, lng: 139.77223, dur: 90, fixedTime: '20:00', arriveEarly: 15 }
const BOOKOFF = { name: 'BOOKOFF Akihabara Ekimae', lat: 35.69845, lng: 139.77322, dur: 55 }
const dayOf = (startTime: string, stops: any[]): any => ({ day: '2026-12-02', date: '', area: '', note: '', startTime, stops })
const server = (day: any) => {
  const inp = reviewInputsFromBody(checkDayRequestBody(day, { base: BASE, shopById: new Map(), flight: null }))
  if ('error' in inp) throw new Error(inp.error)
  return { inp, items: serverReviewItems(inp) }
}

test.describe('Check day: the server\'s own findings (lib/itinerary-review-helpers.ts)', () => {
  test('the server\'s schedule is the timeline\'s', () => {
    const day = dayOf('18:00', [{ ...BOOKOFF, hours: '10:00-22:00' }, { name: 'Opens Later', lat: 35.699, lng: 139.771, dur: 30, hours: '21:30-23:00' }, CAFE])
    const { inp } = server(day)
    expect(inp.daySchedule).toEqual(computeDayTimes(day, BASE, new Map()).sched)
  })

  test('an impossible walk and a missed arrive-early are listed, with the AI saying nothing', () => {
    // BOOKOFF until 19:45, then the cafe: there by 19:45 (20:00, 15 min early) — no time to walk.
    let { items } = server(dayOf('18:50', [BOOKOFF, CAFE]))
    // "Leave … earlier" or, for the whole stretch before the cafe, "… need N min more than available".
    const walk = items.find((x) => x.message.includes('BOOKOFF Akihabara Ekimae') && x.message.includes('Final Fantasy Eorzea Cafe'))
    expect(walk, items.map((x) => x.message).join(' | ')).toBeTruthy()
    expect(walk!.severity).toBe('warning')
    expect(walk!.message).toMatch(/earlier to reach Final Fantasy Eorzea Cafe in time|before Final Fantasy Eorzea Cafe at 20:00 need \d+ min more than available/)
    // Its fix comes with it: leave BOOKOFF at the latest time that still reaches the cafe by 19:45.
    expect(walk!.action).toMatchObject({ type: 'set_leave_time', stopIndex: 0, stopName: 'BOOKOFF Akihabara Ekimae', leaveAt: expect.stringMatching(/^19:[0-3]\d$/) })
    expect(items.every((x) => x.source === 'timetable')).toBe(true)
    // The cafe first, but the day starts at 19:40: it can't be reached by 19:45.
    ;({ items } = server(dayOf('19:40', [CAFE])))
    expect(items[0]).toMatchObject({ severity: 'warning', stopIndex: 0, suggestion: expect.stringMatching(/^Start the day by 19:\d\d\.$/) })
    expect(items[0].message).toMatch(/^The day starts at 19:40, too late to reach Final Fantasy Eorzea Cafe by 19:45 \(15 min before its 20:00\) — \d+ min to get there\.$/)
  })

  test('waiting for an opening and a closed shop are listed too; the AI is told they\'re already listed', () => {
    const { items } = server(dayOf('10:00', [
      { name: 'Coffee', lat: 35.7, lng: 139.77, dur: 30, travelMin: 0, travelFrom: '__base__' },
      { name: 'Opens At Eleven', lat: 35.7, lng: 139.77, dur: 30, hours: '11:00-20:00', travelMin: 0, travelFrom: 'Coffee' },
      { name: 'Morning Only', lat: 35.7, lng: 139.77, dur: 30, hours: '08:00-10:30', travelMin: 0, travelFrom: 'Opens At Eleven' },
    ]))
    const msgs = items.map((x) => x.message)
    expect(msgs).toContain('Opens At Eleven: you get there at 10:30 and it opens at 11:00 — 30 min waiting.')
    expect(msgs.some((m) => m.startsWith('Morning Only'))).toBe(true)
    const text = alreadyListedText(items)
    expect(text).toContain("ALREADY LISTED for the owner by the timetable (computed exactly; don't repeat or contradict these):")
    expect(text).toContain('- Opens At Eleven: you get there at 10:30 and it opens at 11:00 — 30 min waiting.')
  })
})

test.describe('/itinerary: the server\'s findings first in the Check day panel', () => {
  test('"⏱ Timetable" items come first, then the AI\'s', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Server Items Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.route('**/api/itinerary-review', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [
      { severity: 'warning', stopIndex: 0, message: 'Leave BOOKOFF 10 min earlier.', suggestion: null, source: 'timetable' },
      { severity: 'tip', stopIndex: null, message: 'A tip from the AI.', suggestion: null },
    ] }) }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.locator('#itl-check-btn').click()
    const items = page.locator('#itl-check-results .ir-item')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveClass(/ir-server/)
    await expect(items.nth(0).locator('.ir-source')).toHaveText('⏱ Timetable')
    await expect(items.nth(1).locator('.ir-source')).toHaveCount(0)
  })
})

test.describe('/itinerary: Apply on the timetable\'s own finding', () => {
  test('"Leave BOOKOFF … earlier" has "Apply: Leave at 19:xx"; applying it removes the problem', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Apply Server Trip ${Date.now()}`), firstTokyoDay: '2026-12-02', lastTokyoDay: '2026-12-03' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    // The endpoint's answer for this day, as it now comes (the server's item with its action).
    const day = dayOf('18:50', [BOOKOFF, CAFE])
    const items = server(day).items
    await page.route('**/api/itinerary-review', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items }) }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate((stops) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; itl.state[0].startTime = '18:50'; itl.state[0].stops = stops; itl.render()
    }, day.stops)
    await page.locator('#itl-check-btn').click()
    const apply = page.locator('#itl-check-results .ir-apply-btn')
    await expect(apply.first()).toHaveText(/^Apply: Leave at 19:[0-3]\d$/)
    await apply.first().click()
    await expect(page.locator('#itl-check-results .ir-applied').first()).toHaveText('Applied ✓')
    const leaveAt = await page.evaluate(() => (window as any).__itl.state[0].stops[0].leaveAt)
    expect(leaveAt).toMatch(/^19:[0-3]\d$/)
    await expect(page.locator('.itl-block').first()).not.toHaveClass(/itl-warn-(fit|leave)/)
  })
})
