import { test, expect } from './fixtures'
import { scheduleDay, LEAVE_BUFFER_MIN, transitRouteUrl, type ScheduleStopInput } from '../src/lib/itinerary-schedule'
import { estimateLeg } from '../src/lib/route-optimizer'

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
    await expect(stopRow('Square Enix Pop Up Cafe').locator('.itn-leave')).toHaveText(`Leave by ${hhmm(18 * 60 + 30 - cafeToTemple - 10)}`)
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
