import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { timelineRange, timelineItems, minutesAtOffset, insertIndexForTime, PX_PER_MIN, MIN_BLOCK_PX } from '../src/lib/itinerary-timeline'
import { scheduleDay } from '../src/lib/itinerary-schedule'
import { estimateLeg } from '../src/lib/route-optimizer'

const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }

// The real Yokohama day, as saved stops.
const YOKOHAMA_DAY = [
  { name: 'Yellow Submarine Shinjuku', hours: '12:00–20:00', tag: '', slot: '', lat: 35.689356, lng: 139.697787, dur: 45, travelMin: 0, travelFrom: '__base__' },
  { name: 'SURUGA-YA Marui City Yokohama', hours: '10:30–20:30', tag: '', slot: '', lat: 35.464556, lng: 139.624649, dur: 45 },
  { name: 'Square Enix Pop Up Cafe Yokohama', hours: '', tag: 'mat', slot: '', lat: 35.4658, lng: 139.6223, dur: 60, fixedTime: '16:30' },
  { name: 'Tokyo Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 120, fixedTime: '19:00', arriveEarly: 30 },
]

// A trip with Tokyo days only (no travel dates, so it never becomes another test's default
// trip), and the page's own state replaced with `stops` for its first day. Saves are answered
// by the mock (and recorded), so the shared plan is never written.
async function openTimeline(page: Page, sanity: any, trackDoc: (id: string) => void, stops: any[], extra: Record<string, unknown> = {}, startTime = '15:06') {
  const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Timeline Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06', ...extra })
  trackDoc(trip._id)
  const saves: any[] = []
  await page.route('**/api/itinerary-save', async (route) => {
    saves.push(JSON.parse(route.request().postDataJSON().data))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto(`/itinerary-timeline?trip=${trip._id}`)
  await expect(page.locator('.itl-grid')).toBeVisible()
  await page.evaluate(({ stops, startTime }) => {
    // @ts-ignore - the page's test hook
    const itl = window.__itl
    itl.state[0].stops = stops
    itl.state[0].startTime = startTime
    itl.render()
  }, { stops, startTime })
  return { trip, saves }
}

test.describe('timeline layout (lib/itinerary-timeline.ts)', () => {
  test('08:00–23:00, widened to whole hours; blocks placed by start and sized by duration', () => {
    const stops = [
      { name: 'A', lat: 35.7, lng: 139.77, durationMin: 90, fixedTime: null, arriveEarlyMin: null, manualTravelMin: 10, noteTravelMin: null },
      { name: 'B', lat: 35.7, lng: 139.77, durationMin: 30, fixedTime: t('23:00'), arriveEarlyMin: null, manualTravelMin: 5, noteTravelMin: null },
    ]
    const sched = scheduleDay(stops, t('07:30'), BASE)
    const range = timelineRange(sched)
    expect(range).toEqual({ start: t('07:00'), end: t('24:00') }) // 07:30 start, ends 23:30
    const items = timelineItems(sched, range)
    const a = items.find((i) => i.kind === 'stop' && i.index === 0)!
    expect(a).toMatchObject({ top: Math.round((t('07:40') - t('07:00')) * PX_PER_MIN), height: Math.round(90 * PX_PER_MIN), start: t('07:40') })
    const travel = items.find((i) => i.kind === 'travel' && i.index === 0)!
    expect(travel).toMatchObject({ top: Math.round(30 * PX_PER_MIN), minutes: 10 })
    expect(MIN_BLOCK_PX).toBeGreaterThan(20)
  })

  test('a tap position rounds to 15 min; a new stop goes after the last one starting at or before it', () => {
    const range = { start: t('08:00'), end: t('23:00') }
    expect(minutesAtOffset(Math.round((t('13:07') - t('08:00')) * PX_PER_MIN), range)).toBe(t('13:00'))
    expect(minutesAtOffset(Math.round((t('13:08') - t('08:00')) * PX_PER_MIN), range)).toBe(t('13:15'))
    expect(insertIndexForTime([t('10:00'), t('12:00'), t('15:00')], t('13:00'))).toBe(2)
    expect(insertIndexForTime([t('10:00'), t('12:00')], t('09:00'))).toBe(0)
    expect(insertIndexForTime([t('10:00'), t('12:00')], t('12:00'))).toBe(2)
  })
})

test.describe('/itinerary-timeline: the day view', () => {
  test('blocks are placed and sized by start time and duration; travel, fixed stops and warnings shown', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    const grid = page.locator('.itl-grid')
    const start = Number(await grid.getAttribute('data-start'))
    const block = (name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })

    const ys = block('Yellow Submarine Shinjuku')
    await expect(ys).toHaveAttribute('data-start', String(t('15:06')))
    await expect(ys).toHaveCSS('top', `${Math.round((t('15:06') - start) * PX_PER_MIN)}px`)
    await expect(ys).toHaveCSS('height', `${Math.round(45 * PX_PER_MIN)}px`)
    await expect(ys.locator('.itl-time')).toHaveText('15:06–15:51')
    await expect(ys.locator('.itl-hours')).toHaveText('12:00–20:00')

    // Travel between stops: a striped block with the minutes.
    const shinjukuToYokohama = estimateLeg({ lat: 35.689356, lng: 139.697787 }, { lat: 35.464556, lng: 139.624649 })!.minutes
    await expect(page.locator('.itl-travel', { hasText: `🚆 ${shinjukuToYokohama} min` })).toHaveCount(1)
    await expect(page.locator('.itl-travel', { hasText: /^🚶 \d+ min$/ }).first()).toBeVisible() // SURUGA-YA -> cafe on foot

    // Fixed stops: 📌, arrive-early.
    await expect(block('Square Enix Pop Up Cafe').locator('.itl-time')).toHaveText('📌 16:30')
    await expect(block('Tokyo Temple').locator('.itl-time')).toHaveText('📌 19:00 (arrive 18:30)')
    await expect(block('Tokyo Temple')).toHaveClass(/itl-fixed/)

    // Warnings as a colored edge and a badge.
    await expect(block('SURUGA-YA')).toHaveClass(/itl-warn-fit/)
    await expect(block('SURUGA-YA').locator('.itl-badge')).toHaveText(/^⚠️ Doesn't fit before 16:30 \(\d+ min short\)$/)
  })

  test('a closed shop is marked', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Early Shop', hours: '11:00–20:00', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, travelMin: 0, travelFrom: '__base__' },
    ], {}, '09:00')
    const block = page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Early Shop' }) })
    await expect(block).toHaveClass(/itl-warn-closed/)
    await expect(block.locator('.itl-badge')).toHaveText('⚠️ Closed ~09:00?')
  })

  test('the flight deadline is a line on the flight day', async ({ page, sanity, trackDoc }) => {
    const { trip } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, { flightHomeTime: '23:00', flightHomeAirport: 'Narita', flightHomeTerminal: 'T1' })
    await expect(page.locator('.itl-flight')).toHaveCount(0) // day 1 isn't the flight day
    await page.locator('.itl-tab', { hasText: '6. des (søn)' }).click()
    await expect(page).toHaveURL(new RegExp(`trip=${trip._id}.*day=2026-12-06`))
    const start = Number(await page.locator('.itl-grid').getAttribute('data-start'))
    const line = page.locator('.itl-flight')
    await expect(line).toHaveText('✈️ Leave for Narita by 18:30 (Flight 23:00 from Narita (T1))')
    await expect(line).toHaveCSS('top', `${Math.round((t('18:30') - start) * PX_PER_MIN)}px`)
  })
})

test.describe('/itinerary-timeline: the "now" line on a phone set to Norwegian time', () => {
  test.use({ timezoneId: 'Europe/Oslo' })

  test('is drawn at the time in Tokyo on today\'s date there', async ({ page, sanity, trackDoc }) => {
    // 14:00 in Tokyo on 5 December = 06:00 in Oslo.
    await page.clock.setFixedTime(new Date('2026-12-05T14:00:00+09:00'))
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await expect(page.locator('.itl-tab.active')).toHaveText('5. des (lør)') // today in Tokyo
    const start = Number(await page.locator('.itl-grid').getAttribute('data-start'))
    const now = page.locator('.itl-now')
    await expect(now).toBeVisible()
    await expect(now).toHaveAttribute('data-minutes', String(t('14:00')))
    await expect(now).toHaveCSS('top', `${Math.round((t('14:00') - start) * PX_PER_MIN)}px`)
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await expect(page.locator('.itl-now')).toBeHidden() // not today
  })
})
