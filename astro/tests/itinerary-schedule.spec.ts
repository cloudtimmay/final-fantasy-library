import { test, expect, testName } from './fixtures'
import { scheduleDay, LEAVE_BUFFER_MIN, transitRouteUrl, leaveReminderIcs, nextLeave, type ScheduleStopInput } from '../src/lib/itinerary-schedule'
import { tokyoInstant, tokyoNow } from '../src/lib/trip-dates'
import { estimateLeg } from '../src/lib/route-optimizer'
import { buildUserPrompt, scheduleReviewItems, TIGHT_CONNECTION_MIN } from '../src/lib/itinerary-review-helpers'

const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 } // Akihabara
const stop = (name: string, lat: number | null, lng: number | null, extra: Partial<ScheduleStopInput> = {}): ScheduleStopInput => ({
  name, lat, lng, durationMin: 45, fixedTime: null, arriveEarlyMin: null, manualTravelMin: null, noteTravelMin: null, ...extra,
})

// The real day: Yellow Submarine Shinjuku at 15:06, then SURUGA-YA Yokohama, the Square Enix
// Pop Up Cafe Yokohama (table at 16:30), and Tokyo Temple (session 19:00, be there 30 min early).
const YELLOW_SUB = stop('Yellow Submarine Shinjuku', 35.689356, 139.697787, { manualTravelMin: 0 })
const SURUGA = stop('SURUGA-YA Marui City Yokohama', 35.464556, 139.624649)
const CAFE = stop('Square Enix Pop Up Cafe Yokohama', 35.4658, 139.6223, { fixedTime: t('16:30'), durationMin: 60 })
const TEMPLE = stop('Tokyo Temple', 35.6526, 139.7279, { fixedTime: t('19:00'), arriveEarlyMin: 30, durationMin: 120 })

test.describe('itinerary schedule: fixed-time stops are anchors', () => {
  test('the real day: SURUGA-YA doesn\'t fit before the 16:30 cafe; the cafe can stay until the Temple run', () => {
    const day = scheduleDay([YELLOW_SUB, SURUGA, CAFE, TEMPLE], t('15:06'), BASE)
    const [ys, suruga, cafe, temple] = day.stops

    expect(ys.start).toBe(t('15:06'))
    const shinjukuToYokohama = estimateLeg(YELLOW_SUB, SURUGA)!.minutes
    expect(shinjukuToYokohama).toBeLessThanOrEqual(48) // not 109 any more
    expect(suruga.travelIn).toEqual({ minutes: shinjukuToYokohama, source: 'estimate', mode: 'train' })

    // SURUGA-YA starts after the cafe's 16:30 — and says so.
    expect(suruga.start).toBeGreaterThan(t('16:30'))
    expect(suruga.doesntFit).toMatchObject({ anchorIndex: 2, anchorTime: t('16:30') })
    const toCafe = estimateLeg(SURUGA, CAFE)!.minutes
    expect(suruga.doesntFit!.shortMin).toBe(suruga.end - (t('16:30') - toCafe - LEAVE_BUFFER_MIN))
    expect(suruga.leaveBy).toBe(t('16:30') - toCafe - LEAVE_BUFFER_MIN)

    // The cafe is an anchor: 16:30–17:30, whatever the stops before it.
    expect(cafe).toMatchObject({ fixed: true, arrival: t('16:30'), start: t('16:30'), end: t('17:30') })
    // Stay until: reach the Temple by 18:30 (19:00 − 30 min early), minus the trip and the buffer.
    const cafeToTemple = estimateLeg(CAFE, TEMPLE)!.minutes
    expect(cafeToTemple).toBeGreaterThanOrEqual(45)
    expect(cafeToTemple).toBeLessThanOrEqual(60)
    expect(cafe.stayUntil).toBe(t('18:30') - cafeToTemple - LEAVE_BUFFER_MIN)
    expect(cafe.leaveBy).toBe(cafe.stayUntil)
    expect(cafe.leaveEarlierMin).toBeNull() // ends 17:30, in time

    // Arrive early: the Temple's anchor is 18:30, the session 19:00.
    expect(temple).toMatchObject({ arrival: t('18:30'), start: t('19:00'), end: t('21:00') })
    expect(temple.leaveBy).toBeNull() // last stop
  })

  test('a non-fixed stop that fits gets "leave by" its end, no warning', () => {
    const day = scheduleDay([stop('A', 35.70, 139.77, { manualTravelMin: 5 }), stop('B', 35.701, 139.771)], t('10:00'), BASE)
    expect(day.stops[0].leaveBy).toBe(day.stops[0].end)
    expect(day.stops[0].doesntFit).toBeNull()
    expect(day.stops[0].leaveEarlierMin).toBeNull()
  })

  test('a fixed stop that ends too late before the next anchor: "leave N min earlier"', () => {
    const lunch = stop('Lunch', 35.70, 139.77, { fixedTime: t('12:00'), durationMin: 90, manualTravelMin: 10 })
    const show = stop('Show', 35.70, 139.77, { fixedTime: t('13:30'), manualTravelMin: 20 })
    const [l] = scheduleDay([lunch, show], t('11:00'), BASE).stops
    // Must leave by 13:30 − 20 − 10 = 13:00; lunch ends 13:30.
    expect(l.stayUntil).toBe(t('13:00'))
    expect(l.leaveEarlierMin).toBe(30)
  })

  test('moving a stop after the anchor clears the warning (it\'s recomputed from the order)', () => {
    const before = scheduleDay([YELLOW_SUB, SURUGA, CAFE, TEMPLE], t('15:06'), BASE)
    expect(before.stops[1].doesntFit).not.toBeNull()
    // After the cafe it no longer blocks 16:30 — but ending 18:19 it's now too late for the
    // Temple run, so the warning moves to the Temple anchor.
    const after = scheduleDay([YELLOW_SUB, CAFE, SURUGA, TEMPLE], t('15:06'), BASE)
    expect(after.stops[2].doesntFit).toMatchObject({ anchorIndex: 3, anchorTime: t('19:00') })
  })
})

test.describe('itinerary schedule: travel time per leg', () => {
  test('a time entered for the leg wins, then the shop note (first leg only), then the estimate', () => {
    const a = stop('A', 35.689, 139.697, { noteTravelMin: 25 })
    const b = stop('B', 35.464, 139.624, { noteTravelMin: 33 })
    const c = stop('C', 35.465, 139.622, { manualTravelMin: 7, noteTravelMin: 50 })
    const day = scheduleDay([a, b, c], t('09:00'), BASE)
    expect(day.stops[0].travelIn).toEqual({ minutes: 25, source: 'note', mode: null }) // from the base
    expect(day.stops[1].travelIn.source).toBe('estimate') // a note describes the trip from Akihabara only
    expect(day.stops[2].travelIn).toEqual({ minutes: 7, source: 'manual', mode: null })
  })

  test('the Google Maps transit link uses coordinates when both ends have them, names otherwise', () => {
    expect(transitRouteUrl({ name: 'A', lat: 35.1, lng: 139.2 }, { name: 'B', lat: 35.3, lng: 139.4 })).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=35.1%2C139.2&destination=35.3%2C139.4&travelmode=transit'
    )
    expect(transitRouteUrl({ name: 'Nakano Broadway', lat: null, lng: null }, { name: 'B', lat: 35.3, lng: 139.4 })).toContain('origin=Nakano%20Broadway')
  })
})

test.describe('itinerary page: anchors, leave-by and travel per leg', () => {
  // The real day, injected into the page's own state (saves are answered by the mock, so
  // the shared plan is never written).
  async function realDay(page: import('@playwright/test').Page) {
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate(() => {
      // @ts-ignore - globals of the page's own inline script
      state[0] = {
        // @ts-ignore
        day: state[0].day, date: state[0].date, area: 'Yokohama', note: '', startTime: '15:06',
        stops: [
          { name: 'Yellow Submarine Shinjuku', hours: '', tag: '', slot: '', lat: 35.689356, lng: 139.697787, dur: 45, travelMin: 0, travelFrom: '__base__' },
          { name: 'SURUGA-YA Marui City Yokohama', hours: '', tag: '', slot: '', lat: 35.464556, lng: 139.624649, dur: 45 },
          { name: 'Square Enix Pop Up Cafe Yokohama', hours: '', tag: '', slot: '', lat: 35.4658, lng: 139.6223, dur: 60, fixedTime: '16:30' },
          { name: 'Tokyo Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 120, fixedTime: '19:00', arriveEarly: 30 },
        ],
      }
      // @ts-ignore
      render()
    })
    const card = page.locator('.day-card').first()
    const stopRow = (name: string) => card.locator('li.stop[data-idx]').filter({ has: page.locator('.stop-name', { hasText: name }) })
    return { saves, card, stopRow }
  }

  test('the real day: SURUGA-YA flagged before the 16:30 cafe, the cafe\'s stay-until from the Temple at 18:30', async ({ page }) => {
    const { card, stopRow } = await realDay(page)
    const shinjukuToYokohama = estimateLeg({ lat: 35.689356, lng: 139.697787 }, { lat: 35.464556, lng: 139.624649 })!.minutes
    const cafeToTemple = estimateLeg({ lat: 35.4658, lng: 139.6223 }, { lat: 35.6526, lng: 139.7279 })!.minutes
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

    await expect(card.locator('.itn-travel', { hasText: `🚃 ~${shinjukuToYokohama} min (estimate)` })).toBeVisible()
    await expect(stopRow('SURUGA-YA').locator('.itn-warn')).toHaveText(/^⚠️ Doesn't fit before Square Enix Pop Up Cafe Yokohama 16:30 \(\d+ min short\)$/)
    await expect(stopRow('Square Enix Pop Up Cafe').locator('.itn-stay')).toHaveText(`You can stay until ${hhmm(18 * 60 + 30 - cafeToTemple - 10)}`)
    await expect(stopRow('Square Enix Pop Up Cafe').locator('.itn-leave')).toContainText(`Leave by ${hhmm(18 * 60 + 30 - cafeToTemple - 10)}`)
    await expect(stopRow('Tokyo Temple').locator('.stop-time')).toHaveText('19:00 📌(arrive 18:30)')
    await expect(stopRow('Yellow Submarine').locator('.stop-time')).toHaveText('15:06')
  })

  test('moving a stop recomputes the warnings immediately', async ({ page }) => {
    const { card, stopRow } = await realDay(page)
    await expect(stopRow('SURUGA-YA').locator('.itn-warn')).toContainText('before Square Enix Pop Up Cafe Yokohama 16:30')
    await stopRow('SURUGA-YA').locator('.mv.down').click()
    // Now after the cafe: no longer blocking 16:30 (it's flagged against the Temple run instead).
    await expect(card.locator('li.stop[data-idx]').filter({ has: page.locator('.stop-name', { hasText: 'SURUGA-YA' }) }).locator('.itn-warn')).toContainText('before Tokyo Temple 19:00')
  })

  test('a travel time entered for a leg wins over the estimate and is saved on the stop', async ({ page }) => {
    const { card, saves, stopRow } = await realDay(page)
    const travel = card.locator('.itn-travel[data-idx="1"]')
    await expect(travel).toContainText('(estimate)')
    await travel.click()
    const editor = card.locator('.itn-travel-edit[data-idx="1"]')
    await expect(editor).toBeVisible()
    await expect(editor.locator('.itn-route')).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&origin=35.689356%2C139.697787&destination=35.464556%2C139.624649&travelmode=transit')
    await editor.locator('.itn-travel-min').fill('35')
    await editor.locator('.itn-travel-save').click()

    await expect(card.locator('.itn-travel[data-idx="1"]')).toHaveText('🕒 35 min (your time) →')
    await expect(stopRow('SURUGA-YA').locator('.stop-time')).toHaveText('16:26') // 15:51 + 35
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    const saved = saves[saves.length - 1].days
    const savedStop = Object.values(saved).flatMap((d: any) => d.stops).find((s: any) => s.name === 'SURUGA-YA Marui City Yokohama') as any
    expect(savedStop).toMatchObject({ travelMin: 35, travelFrom: 'Yellow Submarine Shinjuku' })
  })

  test('"arrive N min early" on a fixed stop moves its anchor', async ({ page }) => {
    const { stopRow } = await realDay(page)
    const cafe = stopRow('Square Enix Pop Up Cafe')
    await expect(cafe.locator('.stop-time')).toHaveText('16:30 📌')
    await cafe.locator('.more-btn').click()
    const panel = page.locator('.mc-panel.open')
    await panel.locator('.mc-early').fill('15')
    await panel.locator('.mc-early').dispatchEvent('change')
    await expect(stopRow('Square Enix Pop Up Cafe').locator('.stop-time')).toHaveText('16:30 📌(arrive 16:15)')
  })
})

test.describe('itinerary: "⏰ Reminder" (.ics) in Japan time', () => {
  test('Tokyo time converts the same whatever the timezone: 17:35 on 6 Dec in Tokyo is 08:35 UTC', () => {
    expect(tokyoInstant('2026-12-06', 17 * 60 + 35).toISOString()).toBe('2026-12-06T08:35:00.000Z')
    expect(tokyoNow(new Date('2026-12-05T20:10:00Z'))).toEqual({ date: '2026-12-06', minutes: 5 * 60 + 10 })
  })

  test('the event: "Leave <stop> HH:MM JST → <next stop>" at the leave-by time in Asia/Tokyo, alarm at that time, JST note and route link', () => {
    const route = 'https://www.google.com/maps/dir/?api=1&origin=35.4658%2C139.6223&destination=35.6526%2C139.7279&travelmode=transit'
    const ics = leaveReminderIcs({ date: '2026-12-06', leaveBy: 17 * 60 + 35, from: 'Square Enix Pop Up Cafe, Yokohama', to: 'Tokyo Temple', routeUrl: route, now: new Date('2026-11-02T10:00:00Z') })
    const unfolded = ics.replace(/\r\n /g, '')
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true) // folded
    expect(unfolded).toContain('BEGIN:VTIMEZONE\r\nTZID:Asia/Tokyo')
    expect(unfolded).toContain('TZOFFSETTO:+0900')
    expect(unfolded).toContain('DTSTART;TZID=Asia/Tokyo:20261206T173500')
    expect(unfolded).toContain('SUMMARY:Leave Square Enix Pop Up Cafe\\, Yokohama 17:35 JST → Tokyo Temple') // comma escaped
    // The Japan-time note first, then the route (\n is an escaped line break inside the value).
    expect(unfolded).toContain(`DESCRIPTION:Times are Japan time (JST). Your calendar shows this in your phone's current time zone.\\nRoute: ${route}`)
    expect(unfolded).toContain('DESCRIPTION:Leave Square Enix Pop Up Cafe\\, Yokohama 17:35 JST → Tokyo Temple\r\nTRIGGER:PT0M') // the alarm's text
    expect(unfolded).toContain('BEGIN:VALARM\r\nACTION:DISPLAY')
    expect(unfolded).toContain('TRIGGER:PT0M')
    expect(unfolded).toContain('DTSTAMP:20261102T100000Z')
  })
})

test.describe('itinerary page: reminder link on a phone set to Norwegian time', () => {
  test.use({ timezoneId: 'Europe/Oslo' })

  test('the cafe\'s reminder is at its leave-by time in Asia/Tokyo', async ({ page }) => {
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    const date = await page.evaluate(() => {
      // @ts-ignore - globals of the page's own inline script
      state[0].stops = [
        { name: 'Square Enix Pop Up Cafe Yokohama', hours: '', tag: '', slot: '', lat: 35.4658, lng: 139.6223, dur: 60, fixedTime: '16:30' },
        { name: 'Tokyo Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 120, fixedTime: '19:00', arriveEarly: 30 },
      ]
      // @ts-ignore
      render()
      // @ts-ignore
      return state[0].day
    })
    const cafeToTemple = estimateLeg({ lat: 35.4658, lng: 139.6223 }, { lat: 35.6526, lng: 139.7279 })!.minutes
    const leaveBy = 18 * 60 + 30 - cafeToTemple - 10
    const hhmm = String(Math.floor(leaveBy / 60)).padStart(2, '0') + String(leaveBy % 60).padStart(2, '0')

    const link = page.locator('.day-card').first().locator('.itn-reminder')
    await expect(link).toHaveText('⏰ Reminder')
    await expect(link).toHaveAttribute('download', `leave-${date}-${hhmm}.ics`)
    const href = (await link.getAttribute('href'))!
    expect(href.startsWith('data:text/calendar;charset=utf-8,')).toBe(true)
    const ics = decodeURIComponent(href.slice('data:text/calendar;charset=utf-8,'.length)).replace(/\r\n /g, '')
    expect(ics).toContain(`DTSTART;TZID=Asia/Tokyo:${date.replace(/-/g, '')}T${hhmm}00`)
    expect(ics).toContain(`SUMMARY:Leave Square Enix Pop Up Cafe Yokohama ${hhmm.slice(0, 2)}:${hhmm.slice(2)} JST → Tokyo Temple`)
    expect(ics).toContain("DESCRIPTION:Times are Japan time (JST). Your calendar shows this in your phone's current time zone.")
    expect(ics).toContain('travelmode=transit')
  })
})

test.describe('itinerary: "Next: leave … by …" during the trip', () => {
  test('nextLeave: today\'s next leave-by in Tokyo, not yesterday\'s or one that has passed', () => {
    const entries = [
      { date: '2026-12-05', from: 'A', to: 'B', leaveBy: 20 * 60 },
      { date: '2026-12-06', from: 'C', to: 'D', leaveBy: 12 * 60 },
      { date: '2026-12-06', from: 'E', to: 'F', leaveBy: 17 * 60 + 35 },
    ]
    // 17:00 in Tokyo = 08:00 UTC
    expect(nextLeave(entries, new Date('2026-12-06T08:00:00Z'))).toEqual({ date: '2026-12-06', from: 'E', to: 'F', leaveBy: 17 * 60 + 35, inMin: 35 })
    expect(nextLeave(entries, new Date('2026-12-06T09:00:00Z'))).toBeNull() // 18:00: all gone
  })

  test.describe('on a phone set to Norwegian time', () => {
    test.use({ timezoneId: 'Europe/Oslo' })

    test('shows the next leave-by in Tokyo time, updating every minute', async ({ page, sanity, trackDoc }) => {
      const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Next Banner Trip ${Date.now()}`), firstTokyoDay: '2026-12-06', lastTokyoDay: '2026-12-06' })
      trackDoc(trip._id)
      await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
      // 16:59 in Tokyo on 6 December (08:59 in Oslo): the clock runs until paused at 17:00.
      await page.clock.install({ time: new Date('2026-12-06T16:59:00+09:00') })
      await page.goto(`/itinerary?trip=${trip._id}`)
      await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
      await page.clock.pauseAt(new Date('2026-12-06T17:00:00+09:00'))
      await page.evaluate(() => {
        // @ts-ignore - globals of the page's own inline script
        state[0].stops = [
          { name: 'Square Enix Pop Up Cafe Yokohama', hours: '', tag: '', slot: '', lat: 35.4658, lng: 139.6223, dur: 60, fixedTime: '16:30' },
          { name: 'Tokyo Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 120, fixedTime: '19:00', arriveEarly: 30 },
        ]
        // @ts-ignore
        render()
      })
      const cafeToTemple = estimateLeg({ lat: 35.4658, lng: 139.6223 }, { lat: 35.6526, lng: 139.7279 })!.minutes
      const leaveBy = 18 * 60 + 30 - cafeToTemple - LEAVE_BUFFER_MIN
      const hhmm = `${String(Math.floor(leaveBy / 60)).padStart(2, '0')}:${String(leaveBy % 60).padStart(2, '0')}`
      const banner = page.locator('#itn-next')
      await expect(banner).toHaveText(`Next: leave Square Enix Pop Up Cafe Yokohama by ${hhmm} (in ${leaveBy - 17 * 60} min)`)
      await page.clock.runFor(61_000) // to just past 17:01
      await expect(banner).toHaveText(`Next: leave Square Enix Pop Up Cafe Yokohama by ${hhmm} (in ${leaveBy - 17 * 60 - 1} min)`)
    })
  })
})

test.describe('itinerary: "Check day" gets the timetable', () => {
  const realDay = () => {
    const inputs = [YELLOW_SUB, SURUGA, CAFE, TEMPLE]
    const day = scheduleDay(inputs, t('15:06'), BASE)
    return { inputs, day, schedule: day.stops.map((sched, i) => ({ fixedTime: inputs[i].fixedTime, arriveEarlyMin: inputs[i].arriveEarlyMin, sched })) }
  }

  test('the review input has each leg\'s travel time, the anchors, arrive-early and leave-by times', () => {
    const { inputs, day, schedule } = realDay()
    const prompt = buildUserPrompt(
      'Saturday 5 December 2026', 'Yokohama', '15:06',
      inputs.map((s, i) => ({ name: s.name, plannedTime: day.stops[i].start, durationMin: s.durationMin, lat: s.lat, lng: s.lng })),
      inputs.map(() => null), inputs.map(() => null), null, schedule
    )
    const shinjukuToYokohama = estimateLeg(YELLOW_SUB, SURUGA)!.minutes
    expect(prompt).toContain(`Travel here: ${shinjukuToYokohama} min (estimate, by train)`)
    expect(prompt).toContain('Travel here: 0 min (entered by the trip owner)')
    expect(prompt).toContain('FIXED TIME 16:30 (anchor)')
    expect(prompt).toContain('FIXED TIME 19:00 (anchor); must arrive 30 min early, by 18:30')
    expect(prompt).toMatch(/\[2\] Square Enix Pop Up Cafe Yokohama[\s\S]*Leave by: \d\d:\d\d \(next stop has a fixed time; includes a 10-min buffer\)/)
    expect(prompt).toMatch(/Can stay until: \d\d:\d\d/)
    expect(prompt).toMatch(/PROBLEM: can't reach the fixed-time stop \[2\] at 16:30 in time after this \(\d+ min short\)/)
  })

  test('the endpoint\'s own findings: doesn\'t fit, and a tight connection to a fixed stop', () => {
    const { schedule } = realDay()
    const names = [YELLOW_SUB, SURUGA, CAFE, TEMPLE].map((s) => s.name)
    const { day } = realDay()
    const items = scheduleReviewItems(names, schedule, day.segments)
    // One item for the segment before the cafe — not one per stop.
    const segmentItems = items.filter((i) => i.message.startsWith('The stops before'))
    expect(segmentItems).toHaveLength(1)
    expect(segmentItems[0].message).toMatch(/^The stops before Square Enix Pop Up Cafe Yokohama at 16:30 need \d+ min more than available — from Yellow Submarine Shinjuku on, you won't make it in time\.$/)

    // A cafe visit ending 5 min before it must leave for the Temple: tight.
    const tight = scheduleDay([{ ...CAFE, durationMin: 60 }, TEMPLE], t('16:00'), BASE)
    const cafe = tight.stops[0]
    const spare = cafe.leaveBy! - cafe.end
    const tightItems = scheduleReviewItems([CAFE.name, TEMPLE.name], tight.stops.map((sched, i) => ({ fixedTime: [CAFE, TEMPLE][i].fixedTime, arriveEarlyMin: [CAFE, TEMPLE][i].arriveEarlyMin, sched })))
    if (spare >= 0 && spare < TIGHT_CONNECTION_MIN) expect(tightItems[0].message).toContain('Tight connection')
    const longer = scheduleDay([{ ...CAFE, durationMin: 60 + spare - 3 }, TEMPLE], t('16:00'), BASE)
    const longerItems = scheduleReviewItems([CAFE.name, TEMPLE.name], longer.stops.map((sched, i) => ({ fixedTime: [CAFE, TEMPLE][i].fixedTime, arriveEarlyMin: [CAFE, TEMPLE][i].arriveEarlyMin, sched })))
    expect(longerItems).toEqual([expect.objectContaining({ severity: 'tip', stopIndex: 0, message: expect.stringContaining('Tight connection: only 3 min spare') })])
  })

  test('"Check day" sends what the review needs to recompute the timetable', async ({ page }) => {
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    let body: any = null
    await page.route('**/api/itinerary-review', async (route) => {
      body = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) })
    })
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate(() => {
      // @ts-ignore - globals of the page's own inline script
      state[0].startTime = '15:06'
      // @ts-ignore
      state[0].stops = [
        { name: 'Yellow Submarine Shinjuku', hours: '', tag: '', slot: '', lat: 35.689356, lng: 139.697787, dur: 45, travelMin: 0, travelFrom: '__base__' },
        { name: 'Square Enix Pop Up Cafe Yokohama', hours: '', tag: '', slot: '', lat: 35.4658, lng: 139.6223, dur: 60, fixedTime: '16:30' },
        { name: 'Tokyo Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 120, fixedTime: '19:00', arriveEarly: 30 },
      ]
      // @ts-ignore
      render()
    })
    await page.locator('.day-card').first().locator('.day-check-btn').click()
    await expect.poll(() => body).toBeTruthy()
    expect(body.base).toEqual({ lat: 35.697999, lng: 139.77083 })
    expect(body.stops.map((s: any) => [s.fixedTime, s.arriveEarlyMin, s.manualTravelMin])).toEqual([[null, null, 0], ['16:30', null, null], ['19:00', 30, null]])
  })
})

test.describe('itinerary: "doesn\'t fit" per segment, not per stop', () => {
  // Every stop at the same place (1-min walks), so only the times matter; travel entered per leg.
  const P = { lat: 35.6978, lng: 139.7704 }
  const s2 = (name: string, durationMin: number, extra: Partial<ScheduleStopInput> = {}) => stop(name, P.lat, P.lng, { durationMin, manualTravelMin: 10, ...extra })

  // The real day: from 10:02 to a 20:00 dinner at the Final Fantasy Eorzea Cafe, 15 min over.
  const dayStops = () => [
    s2('Super Potato', 120, { manualTravelMin: 2, must: true }), // 10:02–12:02
    s2('Animate', 60), //                                          12:12–13:12
    s2('Retro Game Camp', 90), //                                  13:22–14:52
    s2('Liberty Akihabara 5', 45), //                              15:02–15:47
    s2('Yodobashi Camera Akiba', 30), //                           15:57–16:27
    s2('BicCamera AKIBA', 180), //                                 16:37–19:37
    s2('BOOKOFF Akihabara Ekimae', 3), //                          19:47–19:50
    s2('Final Fantasy Eorzea Cafe', 90, { fixedTime: t('20:00'), manualTravelMin: 15 }), // 19:50 + 15 + 10 = 20:15
  ]

  test('the real day: one 15-min overrun for the segment; only the late stop flagged; suggestions skip MUST', () => {
    const day = scheduleDay(dayStops(), t('10:00'), P)
    expect(day.stops[0].start).toBe(t('10:02'))
    expect(day.segments).toEqual([{
      anchorIndex: 7, anchorTime: t('20:00'), overrunMin: 15, firstLateIndex: 6,
      suggestions: [
        { index: 5, name: 'BicCamera AKIBA', durationMin: 180 },
        { index: 2, name: 'Retro Game Camp', durationMin: 90 },
        { index: 1, name: 'Animate', durationMin: 60 },
      ], // Super Potato (120, MUST) is not suggested
    }])
    expect(day.stops.slice(0, 6).every((x) => x.doesntFit === null)).toBe(true) // no warning hours earlier
    expect(day.stops[6].doesntFit).toEqual({ anchorIndex: 7, anchorTime: t('20:00'), shortMin: 15 })
    expect(day.stops[5].leaveBy).toBe(day.stops[5].end) // "Leave by" unchanged
  })

  test('a segment that fits: no messages', () => {
    const stops = dayStops()
    stops[5] = { ...stops[5], durationMin: 150 } // 30 min shorter
    const day = scheduleDay(stops, t('10:00'), P)
    expect(day.segments).toEqual([])
    expect(day.stops.every((x) => x.doesntFit === null)).toBe(true)
  })

  test('two anchors on one day: each segment gets its own overrun', () => {
    const stops = [
      s2('A', 60, { manualTravelMin: 0 }), //                  10:00–11:00
      s2('B', 100), //                                          11:10–12:50
      s2('Lunch', 60, { fixedTime: t('13:00'), manualTravelMin: 5 }), // 12:50 + 5 + 10 = 13:05 -> 5 over
      s2('C', 60), //                                           14:10–15:10
      s2('D', 120), //                                          15:20–17:20
      s2('Show', 60, { fixedTime: t('17:30'), manualTravelMin: 20 }), // 17:20 + 20 + 10 = 17:50 -> 20 over
    ]
    const day = scheduleDay(stops, t('10:00'), P)
    expect(day.segments.map((g) => [g.anchorIndex, g.overrunMin, g.firstLateIndex])).toEqual([[2, 5, 1], [5, 20, 4]])
    expect(day.stops.map((x) => x.doesntFit?.anchorIndex ?? null)).toEqual([null, 2, null, null, 5, null])
    expect(scheduleReviewItems(stops.map((x) => x.name), day.stops.map((sched, i) => ({ fixedTime: stops[i].fixedTime, arriveEarlyMin: null, sched })), day.segments)
      .filter((i) => i.message.startsWith('The stops before')).map((i) => i.message.match(/need (\d+) min/)![1])).toEqual(['5', '20'])
  })

  test('the page: one segment message above the cafe, no warning on the early stops', async ({ page }) => {
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((stops) => {
      // @ts-ignore - globals of the page's own inline script
      state[0].startTime = '10:00'
      // @ts-ignore
      state[0].stops = stops
      // @ts-ignore
      render()
    }, dayStops().map((x, i) => ({
      name: x.name, hours: '', tag: x.must ? 'MUST' : '', slot: '', lat: x.lat, lng: x.lng, dur: x.durationMin,
      travelMin: x.manualTravelMin, travelFrom: i === 0 ? '__base__' : dayStops()[i - 1].name,
      ...(x.fixedTime != null ? { fixedTime: '20:00' } : {}),
    })))
    const card = page.locator('.day-card').first()
    const segment = card.locator('.itn-segment')
    await expect(segment).toHaveCount(1)
    await expect(segment).toContainText('⚠️ The stops before Final Fantasy Eorzea Cafe 20:00 need 15 min more than available. Shorten a visit or remove a stop.')
    await expect(segment.locator('.itn-segment-tips')).toHaveText('Longest visits: BicCamera AKIBA (180 min), Retro Game Camp (90 min), Animate (60 min)')
    // The segment message sits just above the travel line into the cafe.
    await expect(card.locator('.itn-segment + li.walk-row .itn-travel[data-idx="7"]')).toHaveCount(1)
    await expect(card.locator('li.stop .itn-warn')).toHaveCount(1)
    const late = card.locator('li.stop[data-idx]').filter({ has: page.locator('.stop-name', { hasText: 'BOOKOFF Akihabara Ekimae' }) })
    await expect(late.locator('.itn-warn')).toHaveText("⚠️ Doesn't fit before Final Fantasy Eorzea Cafe 20:00 (15 min short)")
  })
})

test.describe('itinerary schedule: actual times', () => {
  test('an actual start/end moves the following stops; a fixed stop never moves, its warning updates', () => {
    const planned = scheduleDay([YELLOW_SUB, SURUGA, CAFE, TEMPLE], t('15:06'), BASE)
    const here = scheduleDay([{ ...YELLOW_SUB, actualStart: t('15:30') }, SURUGA, CAFE, TEMPLE], t('15:06'), BASE)
    expect(here.stops[0]).toMatchObject({ start: t('15:30'), end: t('16:15'), actual: true, visited: false })
    expect(here.stops[1].start).toBe(planned.stops[1].start + 24)
    expect(here.stops[2]).toMatchObject({ start: t('16:30'), end: t('17:30') })
    expect(here.stops[1].doesntFit!.shortMin).toBe(planned.stops[1].doesntFit!.shortMin + 24)

    const left = scheduleDay([{ ...YELLOW_SUB, actualStart: t('15:30'), actualEnd: t('15:40') }, SURUGA, CAFE, TEMPLE], t('15:06'), BASE)
    expect(left.stops[0]).toMatchObject({ start: t('15:30'), end: t('15:40'), visited: true, doesntFit: null })
    expect(left.stops[1].start).toBe(t('15:40') + estimateLeg(YELLOW_SUB, SURUGA)!.minutes)
  })

  test('a fixed stop left late moves what comes after it, not itself', () => {
    const cafeLate = scheduleDay([{ ...CAFE, actualStart: t('16:45'), actualEnd: t('18:10') }, TEMPLE], t('16:00'), BASE)
    expect(cafeLate.stops[0]).toMatchObject({ start: t('16:30'), end: t('18:10'), visited: true, leaveEarlierMin: null })
    expect(cafeLate.stops[1]).toMatchObject({ arrival: t('18:30'), start: t('19:00') }) // the Temple stays too
  })
})
