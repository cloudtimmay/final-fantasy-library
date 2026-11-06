import type { Page } from '@playwright/test'
import { test, expect, testName, uniqueJan } from './fixtures'
import { uniquePng } from './helpers/unique-image'
import { timelineRange, timelineItems, layoutTimeline, minutesAtOffset, insertIndexForTime, DEFAULT_PX_PER_MIN as PX_PER_MIN, MIN_BLOCK_PX, ZOOM_LEVELS } from '../src/lib/itinerary-timeline'
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
async function openTimeline(page: Page, sanity: any, trackDoc: (id: string) => void, stops: any[], extra: Record<string, unknown> = {}, startTime = '15:06', query = '') {
  const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Timeline Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06', ...extra })
  trackDoc(trip._id)
  const saves: any[] = []
  await page.route('**/api/itinerary-save', async (route) => {
    saves.push(JSON.parse(route.request().postDataJSON().data))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto(`/itinerary?trip=${trip._id}${query}`)
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
    expect(range).toEqual({ start: t('06:00'), end: t('24:00') }) // 07:30 start (an hour before: 06:30), ends 23:30
    // The day's start, a landing and the time to leave for the airport count too; never before 00:00.
    expect(timelineRange(sched, { dayStart: t('06:15') }).start).toBe(t('05:00'))
    expect(timelineRange(sched, { events: [t('05:55')] }).start).toBe(t('04:00'))
    expect(timelineRange(sched, { dayStart: t('00:30') }).start).toBe(0)
    expect(timelineRange(scheduleDay([], t('10:00'), BASE), { dayStart: t('10:00') })).toEqual({ start: t('08:00'), end: t('23:00') })
    const items = timelineItems(sched, range)
    const a = items.find((i) => i.kind === 'stop' && i.index === 0)!
    expect(a).toMatchObject({ top: Math.round((t('07:40') - t('06:00')) * PX_PER_MIN), height: Math.round(90 * PX_PER_MIN), start: t('07:40') })
    const travel = items.find((i) => i.kind === 'travel' && i.index === 0)!
    expect(travel).toMatchObject({ top: Math.round(90 * PX_PER_MIN), minutes: 10 }) // leaves 07:30, 90 min after 06:00
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

test.describe('/itinerary: the day view', () => {
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
    await expect(block.locator('.itl-hours-badge')).toHaveText('Opens 11:00')
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

test.describe('/itinerary: the "now" line on a phone set to Norwegian time', () => {
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

test.describe('/itinerary: tap an empty spot to add a stop', () => {
  // These open the timeline (and the list) several times each; under the parallel run they timed
  // out twice at the default 30 s. The page now loads its data in parallel (much faster); this
  // margin is on top of that.
  test.describe.configure({ timeout: 60_000 })
  // A tap on the grid itself (left of the blocks) at `hhmm`.
  async function tapAt(page: Page, hhmm: string) {
    const grid = page.locator('.itl-grid')
    const start = Number(await grid.getAttribute('data-start'))
    await grid.click({ position: { x: 3, y: Math.round((t(hhmm) - start) * PX_PER_MIN) + 2 } })
  }

  test('a stop added at 17:00 goes after the stops starting before 17:00, not pinned; saved in the list\'s format', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await tapAt(page, '17:00')
    const form = page.locator('#itl-add')
    await expect(form).toBeVisible()
    await expect(page.locator('#itl-add-time')).toHaveText('17:00')
    await page.locator('#itl-add-shop').selectOption('__custom__')
    await page.locator('#itl-add-name').fill('Test Insert')
    await page.locator('#itl-add-dur').fill('30')
    await page.locator('#itl-add-save').click()
    await expect(form).toBeHidden()

    // Starts: Yellow Sub 15:06, SURUGA-YA ~16:39, cafe 16:30 -> after all three, before the Temple.
    const names = await page.evaluate(() => (window as any).__itl.state[0].stops.map((s: any) => s.name))
    expect(names).toEqual(['Yellow Submarine Shinjuku', 'SURUGA-YA Marui City Yokohama', 'Square Enix Pop Up Cafe Yokohama', 'Test Insert', 'Tokyo Temple'])
    // Recalculated: it runs from the cafe's end (17:30) + the walk, not 17:00.
    const added = page.locator('.itl-block.itl-new')
    await expect(added.locator('.itl-name')).toHaveText('Test Insert')
    expect(Number(await added.getAttribute('data-start'))).toBeGreaterThanOrEqual(t('17:30'))

    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    const saved = saves[saves.length - 1]
    expect(Object.keys(saved)).toEqual(['v', 'days'])
    expect(saved.v).toBe(2)
    const day = saved.days['2026-12-05']
    expect(Object.keys(day)).toEqual(['startTime', 'stops'])
    expect(day.stops[3]).toEqual({ name: 'Test Insert', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30 }) // no fixedTime
  })

  test('a shop from the picker: the same grouped list and stop shape as /itinerary-list\'s add-stop', async ({ page, sanity, trackDoc }) => {
    const { trip, saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY.slice(0, 1))
    const timelineGroups = await page.locator('#itl-add-shop optgroup').evaluateAll((els) => els.map((e) => [e.getAttribute('label'), e.children.length]))
    // The list for the same trip (its shops come first on both — lib/trip-plans.ts), in a second tab.
    const list = await page.context().newPage()
    await list.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await list.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(list.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    const listGroups = await list.locator('.add-form').first().locator('.af-shop optgroup').evaluateAll((els) => els.map((e) => [e.getAttribute('label'), e.children.length]))
    expect(listGroups.length).toBeGreaterThan(0)
    expect(timelineGroups).toEqual(listGroups)
    await list.close()

    await tapAt(page, '09:00')
    const firstShop = page.locator('#itl-add-shop optgroup option').first()
    const shopName = (await firstShop.textContent())!.replace(' (uten koord.)', '')
    await page.locator('#itl-add-shop').selectOption(await firstShop.getAttribute('value'))
    await page.locator('#itl-add-save').click()
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    const stop = saves[saves.length - 1].days['2026-12-05'].stops[0] // before the 15:06 stop
    expect(stop).toMatchObject({ name: shopName, tag: expect.any(String), slot: '', dur: 45 })
    expect(Object.keys(stop)).toEqual(['name', 'hours', 'tag', 'slot', 'shopId', 'lat', 'lng', 'dur'])
  })
})

test.describe('/itinerary: block details and the links', () => {
  test('tapping a block shows its details and "Edit in list" opens /itinerary-list with that stop in view', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 15.2 s alone; much slower under 4 parallel workers
    const { trip } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Square Enix Pop Up Cafe' }) }).click()
    const detail = page.locator('#itl-detail')
    await expect(detail).toBeVisible()
    await expect(page.locator('#itl-add')).toBeHidden() // a block tap isn't an "add here" tap
    await expect(page.locator('#itl-detail-name')).toHaveText('Square Enix Pop Up Cafe Yokohama')
    await expect(page.locator('#itl-detail-lines li').first()).toHaveText('📌 16:30–17:30')
    await expect(page.locator('#itl-detail-lines')).toContainText('You can stay until')
    await expect(page.locator('#itl-detail-edit')).toHaveAttribute('href', `/itinerary-list?trip=${trip._id}&day=2026-12-05&stop=2`)

    // The list opens with that day's stop highlighted (its own saved plan, so check by position).
    await page.locator('.itl-block').first().click()
    await expect(page.locator('#itl-detail-edit')).toHaveAttribute('href', `/itinerary-list?trip=${trip._id}&day=2026-12-05&stop=0`)
    await page.locator('#itl-detail-edit').click()
    await expect(page).toHaveURL(`/itinerary-list?trip=${trip._id}&day=2026-12-05&stop=0`)
    await expect(page.locator('.stop.itn-focus[data-day="0"][data-idx="0"]')).toBeVisible({ timeout: 20000 })
  })

  test('"🗓️ Timeline" on /itinerary-list and "📋 List view" on the timeline, keeping the trip', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 11.4 s alone; much slower under 4 parallel workers
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Timeline Links ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    const toTimeline = page.locator('#itn-timeline-link')
    await expect(toTimeline).toHaveText('🗓️ Timeline')
    await toTimeline.click()
    await expect(page).toHaveURL(`/itinerary?trip=${trip._id}`)
    await expect(page.getByRole('heading', { name: /Timeline/ })).toBeVisible()
    const back = page.locator('#itl-list-link')
    await expect(back).toHaveText('📋 List view')
    await back.click()
    await expect(page).toHaveURL(`/itinerary-list?trip=${trip._id}`)
  })
})

// Where an element sits on the screen.
const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!

test.describe('/itinerary on a phone: readable blocks and zoom', () => {
  test('at the default zoom an hour is 135 px, and a 30-min block shows its name', async ({ page, sanity, trackDoc }) => {
    expect(PX_PER_MIN * 60).toBe(135) // between the first 72 px and the later 180 px
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Liberty Akihabara 5 (retro games, 4 floors)', hours: '11:00–20:30 · cash only on floors 3–4', tag: '', slot: '', lat: 35.701461, lng: 139.771787, dur: 30, travelMin: 0, travelFrom: '__base__' },
    ], {}, '11:00')
    const block = page.locator('.itl-block').first()
    const name = block.locator('.itl-name')
    await expect(name).toBeVisible()
    const b = await box(block), n = await box(name)
    expect(b.height).toBe(Math.round(30 * PX_PER_MIN))
    // The name is on the block's first line, inside it, and gets real width (not squeezed away).
    expect(n.y).toBeGreaterThanOrEqual(b.y)
    expect(n.y + n.height).toBeLessThanOrEqual(b.y + b.height)
    expect(n.width).toBeGreaterThan(60)
    const hours = await box(block.locator('.itl-hours'))
    expect(hours.y).toBeGreaterThanOrEqual(n.y + n.height - 1) // opening hours below the name, not over it
  })

  test('"−"/"+" change the hour height, and the zoom is remembered', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 10.1 s alone; much slower under 4 parallel workers
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    const hourGap = async () => {
      const tops = await page.locator('.itl-hour').evaluateAll((els) => els.slice(0, 2).map((e) => (e as HTMLElement).offsetTop))
      return tops[1] - tops[0]
    }
    expect(await hourGap()).toBe(135) // the default
    await page.locator('#itl-zoom-in').click()
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[2]))
    await page.locator('#itl-zoom-out').click()
    await page.locator('#itl-zoom-out').click()
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[0]))
    await expect(page.locator('#itl-zoom-out')).toBeDisabled() // the smallest step

    await page.reload()
    await expect(page.locator('.itl-grid')).toBeVisible()
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[0]))
  })
})

test.describe('/itinerary on a phone: travel chips and overlapping stops', () => {
  const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

  test('a short walk is a chip that overlaps no block; a long trip stays a striped band', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    // SURUGA-YA -> the cafe is a few minutes on foot: too short for its label inside the leg.
    const chip = page.locator('.itl-travel.itl-travel-chip')
    await expect(chip.first()).toHaveText(/^🚶 \d+ min$/)
    const blocks = await page.locator('.itl-block').all()
    for (const c of await chip.all()) {
      const cb = await box(c)
      for (const b of blocks) expect(intersects(cb, await box(b))).toBe(false)
    }
    // Shinjuku -> Yokohama keeps the band, its label inside its own height.
    const band = page.locator('.itl-travel:not(.itl-travel-chip)', { hasText: '🚆' })
    const bb = await box(band.first())
    expect(bb.height).toBeGreaterThanOrEqual(20)
    for (const b of blocks) expect(intersects(bb, await box(b))).toBe(false)
  })

  test('a stop 19:33–20:18 and the fixed Eorzea Cafe at 20:00 get separate columns that don\'t intersect', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'BOOKOFF Akihabara Ekimae', hours: '10:00–22:00', tag: '', slot: '', lat: 35.697734, lng: 139.773475, dur: 45, travelMin: 0, travelFrom: '__base__' },
      { name: 'Final Fantasy Eorzea Cafe', hours: '', tag: 'mat', slot: '', lat: 35.697776, lng: 139.770364, dur: 90, fixedTime: '20:00' },
    ], {}, '19:33')
    const bookoff = page.locator('.itl-block[data-index="0"]')
    const cafe = page.locator('.itl-block[data-index="1"]')
    await expect(bookoff.locator('.itl-time')).toHaveText('19:33–20:18')
    await expect(cafe.locator('.itl-time')).toHaveText('📌 20:00')
    await expect(bookoff).toHaveAttribute('data-cols', '2')
    await expect(cafe).toHaveAttribute('data-cols', '2')
    expect(await bookoff.getAttribute('data-col')).not.toBe(await cafe.getAttribute('data-col'))
    expect(intersects(await box(bookoff), await box(cafe))).toBe(false)
    // Both readable, and the warning styling kept.
    await expect(bookoff.locator('.itl-name')).toBeVisible()
    await expect(cafe.locator('.itl-name')).toBeVisible()
    await expect(bookoff).toHaveClass(/itl-warn-fit/)
    await expect(bookoff.locator('.itl-badge')).toContainText("Doesn't fit before 20:00")
  })

  test('layoutTimeline: overlapping blocks share columns; separate ones keep the full width', () => {
    const stops = [
      { name: 'A', lat: 35.7, lng: 139.77, durationMin: 45, fixedTime: null, arriveEarlyMin: null, manualTravelMin: 0, noteTravelMin: null },
      { name: 'Cafe', lat: 35.7, lng: 139.77, durationMin: 90, fixedTime: t('20:00'), arriveEarlyMin: null, manualTravelMin: 5, noteTravelMin: null },
      { name: 'Late', lat: 35.7, lng: 139.77, durationMin: 30, fixedTime: null, arriveEarlyMin: null, manualTravelMin: 5, noteTravelMin: null },
    ]
    const sched = scheduleDay(stops, t('19:33'), BASE)
    const { stops: placed } = layoutTimeline(sched, timelineRange(sched))
    expect(placed.map((p) => [p.col, p.cols])).toEqual([[0, 2], [1, 2], [0, 1]])
  })
})

test.describe('/itinerary on a phone: the end of the day', () => {
  test('after scrolling to the end, the last block and the last hour are fully visible above the bottom nav', async ({ page, sanity, trackDoc }) => {
    // The last stop ends 22:30, near the bottom of the 08:00–23:00 axis.
    await openTimeline(page, sanity, trackDoc, [
      { name: 'TAITO Station GameWorld', hours: '10:00–01:00', tag: '', slot: '', lat: 35.68991, lng: 139.702255, dur: 60, travelMin: 0, travelFrom: '__base__' },
    ], {}, '21:30')
    // Astro's dev toolbar (dev server only) also sits at the bottom of the screen.
    await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' })
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const nav = await box(page.locator('.bottom-nav'))
    const last = await box(page.locator('.itl-block').last())
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y)
    const lastHour = await box(page.locator('.itl-hour').last())
    expect(lastHour.y + lastHour.height).toBeLessThanOrEqual(nav.y)
  })
})

test.describe('/itinerary: the day toolbar, map, travel editor, Check day and Suggest route', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })

  test('changing the day\'s start time moves the blocks and is saved', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await expect(page.locator('#itl-start')).toHaveValue('15:06')
    await expect(block(page, 'Yellow Submarine')).toHaveAttribute('data-start', String(t('15:06')))
    await page.locator('#itl-start').fill('14:00')
    await page.locator('#itl-start').dispatchEvent('change')
    await expect(block(page, 'Yellow Submarine')).toHaveAttribute('data-start', String(t('14:00')))
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(saves[saves.length - 1].days['2026-12-05'].startTime).toBe('14:00')
  })

  test('"🗺️ Route for the day" goes through the stops in order, base first and last', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    const link = page.locator('.itl-dayroute-link')
    await expect(link).toHaveText('🗺️ Route for the day')
    const url = new URL((await link.getAttribute('href'))!)
    expect(url.searchParams.get('origin')).toBe('35.697999,139.77083')
    expect(url.searchParams.get('destination')).toBe('35.697999,139.77083')
    expect(url.searchParams.get('waypoints')).toBe('35.689356,139.697787|35.464556,139.624649|35.4658,139.6223|35.6526,139.7279')
  })

  test('the map is closed by default and shows the stops numbered in order when opened', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await expect(page.locator('#itl-map')).toBeHidden()
    await page.locator('#itl-map-section summary').click()
    const pins = page.locator('#itl-map .pin:not(.base)')
    await expect(pins).toHaveText(['1', '2', '3', '4'], { timeout: 20000 })
    await expect(page.locator('#itl-map .pin.base')).toHaveCount(1)
  })

  test('a travel time entered on the timeline is saved like the list\'s and moves the following blocks', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await page.locator('.itl-travel[data-index="1"]').click() // Yellow Submarine -> SURUGA-YA
    const editor = page.locator('#itl-travel-editor')
    await expect(editor).toBeVisible()
    await expect(page.locator('#itl-travel-editor-title')).toHaveText('Yellow Submarine Shinjuku → SURUGA-YA Marui City Yokohama')
    await expect(editor.locator('.itn-route')).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&origin=35.689356%2C139.697787&destination=35.464556%2C139.624649&travelmode=transit')
    await editor.locator('.itn-travel-min').fill('35')
    await editor.locator('.itn-travel-save').click()
    await expect(editor).toBeHidden()

    await expect(block(page, 'SURUGA-YA')).toHaveAttribute('data-start', String(t('16:26'))) // 15:51 + 35
    await expect(page.locator('.itl-travel[data-index="1"]')).toHaveText('🚆 35 min')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    const stop = saves[saves.length - 1].days['2026-12-05'].stops[1]
    // The same fields the list writes (tests/itinerary-schedule.spec.ts checks the list's).
    expect(stop).toMatchObject({ travelMin: 35, travelFrom: 'Yellow Submarine Shinjuku' })
  })

  test('Check day: results above the calendar, the stop\'s block marked, tapping the item scrolls to it', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    let body: any = null
    await page.route('**/api/itinerary-review', async (route) => {
      body = route.request().postDataJSON()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [
          { severity: 'warning', stopIndex: 3, message: 'Tight before the Temple.', suggestion: 'Leave the cafe earlier.' },
          { severity: 'tip', stopIndex: null, message: 'Long day.', suggestion: null },
        ] }),
      })
    })
    await page.locator('#itl-check-btn').click()
    const panel = page.locator('#itl-check-results')
    await expect(panel.locator('.ir-item')).toHaveCount(2)
    await expect(panel.locator('.ir-item-stop-link')).toHaveText('Stop 4: Tokyo Temple')
    expect(body).toMatchObject({ dayDate: '2026-12-05', dayStartTime: '15:06' })
    expect(body.stops.map((s: any) => s.name)).toEqual(YOKOHAMA_DAY.map((s) => s.name))

    const temple = block(page, 'Tokyo Temple')
    await expect(temple).toHaveClass(/itl-ir-warning/)
    await expect(temple.locator('.itl-badge', { hasText: '🔍' })).toBeVisible()
    await expect(block(page, 'SURUGA-YA')).not.toHaveClass(/itl-ir-/)

    await page.evaluate(() => window.scrollTo(0, 0))
    await panel.locator('.ir-item-stop-link').click()
    await expect(temple).toBeInViewport()
  })

  test('Suggest route: preview with new order and times, Apply saves it, Undo restores it', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 9.0 s alone; much slower under 4 parallel workers
    // Far first, then Near — base is next to Near, so near-then-far is clearly better.
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { name: 'Far', hours: '', tag: '', slot: '', lat: 35.797999, lng: 139.77083, dur: 30 },
      { name: 'Near', hours: '', tag: '', slot: '', lat: 35.698999, lng: 139.77083, dur: 30 },
    ], {}, '08:00')
    await page.locator('#itl-route-btn').click()
    const panel = page.locator('#itl-route-results')
    await expect(panel.locator('.rt-summary')).toContainText('Saves')
    await expect(panel.locator('.rt-column').nth(1).locator('.rt-list-item')).toHaveText([/^\d\d:\d\d Near$/, /^\d\d:\d\d Far$/])
    const names = () => page.evaluate(() => (window as any).__itl.state[0].stops.map((s: any) => s.name))
    expect(await names()).toEqual(['Far', 'Near']) // nothing changes before Apply

    await panel.locator('.rt-apply-btn').click()
    expect(await names()).toEqual(['Near', 'Far'])
    await expect(panel).toContainText('Route applied ✓')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(saves[saves.length - 1].days['2026-12-05'].stops.map((s: any) => s.name)).toEqual(['Near', 'Far'])

    await panel.locator('.rt-undo-btn').click()
    expect(await names()).toEqual(['Far', 'Near'])
    await expect.poll(() => saves[saves.length - 1].days['2026-12-05'].stops.map((s: any) => s.name), { timeout: 10000 }).toEqual(['Far', 'Near'])
  })
})

test.describe('/itinerary: editing a stop in the sheet', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const lastSave = async (saves: any[]) => {
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    const saved = saves[saves.length - 1]
    expect(Object.keys(saved)).toEqual(['v', 'days']) // the list's format
    return saved.days
  }
  // Wait for the debounced save that carries `check`.
  const savedWhere = async (saves: any[], check: (days: any) => boolean) => {
    await expect.poll(() => saves.length > 0 && check(saves[saves.length - 1].days), { timeout: 10000 }).toBe(true)
    return saves[saves.length - 1].days
  }

  test('duration, tag and note', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await block(page, 'Yellow Submarine').click()
    const sheet = page.locator('#itl-detail')
    await expect(sheet).toBeVisible()
    await expect(page.locator('#itl-ed-dur')).toHaveValue('45')
    await page.locator('#itl-ed-dur').fill('60')
    await page.locator('#itl-ed-dur').dispatchEvent('change')
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('15:06–16:06')
    await page.locator('#itl-ed-tag').fill('MUST')
    await page.locator('#itl-ed-tag').dispatchEvent('change')
    await page.locator('#itl-ed-note').fill('Ask about the FF7 box')
    await page.locator('#itl-ed-note').dispatchEvent('change')
    await expect(sheet).toBeVisible() // stays open on the stop
    const days = await savedWhere(saves, (d) => d['2026-12-05'].stops[0].note === 'Ask about the FF7 box')
    expect(days['2026-12-05'].stops[0]).toMatchObject({ name: 'Yellow Submarine Shinjuku', dur: 60, tag: 'MUST', note: 'Ask about the FF7 box' })
  })

  test('fixed time re-sorts the day and arrive-early appears; ▲▼ reorder', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 11.0 s alone; much slower under 4 parallel workers
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await block(page, 'SURUGA-YA').click()
    await expect(page.locator('#itl-ed-early-label')).toBeHidden()
    await page.locator('#itl-ed-time').fill('17:45')
    await page.locator('#itl-ed-time').dispatchEvent('change')
    // Pinned at 17:45 it now sorts after the 16:30 cafe; the sheet stays on SURUGA-YA.
    await expect(page.locator('#itl-detail-name')).toHaveText('SURUGA-YA Marui City Yokohama')
    await expect(page.locator('#itl-ed-early-label')).toBeVisible()
    await page.locator('#itl-ed-early').fill('15')
    await page.locator('#itl-ed-early').dispatchEvent('change')
    await expect(block(page, 'SURUGA-YA').locator('.itl-time')).toHaveText('📌 17:45 (arrive 17:30)')
    let days = await savedWhere(saves, (d) => d['2026-12-05'].stops[2].arriveEarly === 15)
    expect(days['2026-12-05'].stops.map((s: any) => s.name)).toEqual(['Yellow Submarine Shinjuku', 'Square Enix Pop Up Cafe Yokohama', 'SURUGA-YA Marui City Yokohama', 'Tokyo Temple'])
    expect(days['2026-12-05'].stops[2]).toMatchObject({ fixedTime: '17:45', arriveEarly: 15 })

    await page.locator('#itl-ed-up').click()
    days = await savedWhere(saves, (d) => d['2026-12-05'].stops[1].name.startsWith('SURUGA'))
    expect(days['2026-12-05'].stops.map((s: any) => s.name)).toEqual(['Yellow Submarine Shinjuku', 'SURUGA-YA Marui City Yokohama', 'Square Enix Pop Up Cafe Yokohama', 'Tokyo Temple'])
    await page.locator('#itl-ed-down').click()
    days = await savedWhere(saves, (d) => d['2026-12-05'].stops[2].name.startsWith('SURUGA'))
    expect(days['2026-12-05'].stops[2].name).toBe('SURUGA-YA Marui City Yokohama')
  })

  test('move to another day', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await block(page, 'Yellow Submarine').click()
    await page.locator('#itl-ed-move').selectOption('2026-12-06')
    await expect(page.locator('#itl-detail')).toBeHidden()
    await expect(block(page, 'Yellow Submarine')).toHaveCount(0)
    const days = await savedWhere(saves, (d) => d['2026-12-05'].stops.length === 3)
    expect(days['2026-12-06'].stops.at(-1)).toMatchObject({ name: 'Yellow Submarine Shinjuku' })
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await expect(block(page, 'Yellow Submarine')).toHaveCount(1)
  })

  test('coordinates: paste "lat, lng", or fetch them from the linked shop', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 10.0 s alone; much slower under 4 parallel workers
    await page.route('**/api/shop-coords*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, found: true, hasCoords: true, latitude: 35.7011, longitude: 139.7712 }),
    }))
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { name: 'No Coords Shop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30, travelMin: 0, travelFrom: '__base__' },
      { name: 'Linked Shop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30, shopId: 'test-shop-not-real' },
    ], {}, '10:00')
    await block(page, 'No Coords Shop').click()
    await expect(page.locator('#itl-ed-coord-fetch')).toBeHidden() // not linked to a shop
    await page.locator('#itl-ed-coord').fill('35.6990, 139.7710')
    await page.locator('#itl-ed-coord-save').click()
    await expect(page.locator('#itl-ed-coord-msg')).toHaveText('Lagret ✓ (ikke koblet til en butikk)')
    let days = await savedWhere(saves, (d) => d['2026-12-05'].stops[0].lat === 35.699)
    expect(days['2026-12-05'].stops[0]).toMatchObject({ lat: 35.699, lng: 139.771 })

    await page.locator('#itl-detail-close').click()
    await block(page, 'Linked Shop').click()
    await page.locator('#itl-ed-coord-fetch').click()
    await expect(page.locator('#itl-ed-coord-msg')).toHaveText('Hentet ✓ — koordinater satt fra butikken')
    days = await savedWhere(saves, (d) => d['2026-12-05'].stops[1].lat === 35.7011)
    expect(days['2026-12-05'].stops[1]).toMatchObject({ shopId: 'test-shop-not-real', lat: 35.7011, lng: 139.7712 })
  })

  test('delete asks first: cancel keeps the stop, OK removes it', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await block(page, 'SURUGA-YA').click()
    const messages: string[] = []
    page.once('dialog', (d) => { messages.push(d.message()); d.dismiss() })
    await page.locator('#itl-ed-delete').click()
    await expect.poll(() => messages.length).toBe(1)
    expect(messages[0]).toBe('Delete "SURUGA-YA Marui City Yokohama" from 5. des (lør)?')
    await expect(block(page, 'SURUGA-YA')).toHaveCount(1)

    page.once('dialog', (d) => d.accept())
    await page.locator('#itl-ed-delete').click()
    await expect(page.locator('#itl-detail')).toBeHidden()
    await expect(block(page, 'SURUGA-YA')).toHaveCount(0)
    const days = await lastSave(saves)
    expect(days['2026-12-05'].stops.map((s: any) => s.name)).toEqual(['Yellow Submarine Shinjuku', 'Square Enix Pop Up Cafe Yokohama', 'Tokyo Temple'])
  })
})

test.describe('/itinerary: "I\'m here now" and "Leaving now"', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const shinjukuToYokohama = estimateLeg({ lat: 35.689356, lng: 139.697787 }, { lat: 35.464556, lng: 139.624649 })!.minutes
  // The ?now= test clock, moved on without a reload (the page reads it on every tap).
  const setTestTime = (page: Page, hhmm: string) => page.evaluate((m) => { document.querySelector<HTMLElement>('#itl-test-time')!.dataset.minutes = String(m) }, t(hhmm))
  const savedDay = async (saves: any[], check: (stops: any[]) => boolean) => {
    await expect.poll(() => saves.length > 0 && check(saves[saves.length - 1].days['2026-12-05'].stops), { timeout: 10000 }).toBe(true)
    return saves[saves.length - 1].days['2026-12-05'].stops
  }

  test('?now= sets the clock for this page, with a visible "Test time"', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, {}, '15:06', '&now=2026-12-05T15:30')
    await expect(page.locator('#itl-test-time')).toContainText('🧪 Test time: 2026-12-05 15:30 (Tokyo)')
    await expect(page.locator('.itl-tab.active')).toHaveText('5. des (lør)') // its date is "today"
    await expect(page.locator('.itl-now')).toHaveAttribute('data-minutes', String(t('15:30')))
    await expect(block(page, 'Yellow Submarine').locator('.itl-here')).toBeVisible()
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await expect(page.locator('.itl-here')).toHaveCount(0) // only on today's blocks
  })

  test('I\'m here now / Leaving now shift the following blocks; the fixed cafe stays and its warning updates', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, {}, '15:06', '&now=2026-12-05T15:30')
    const suruga = block(page, 'SURUGA-YA')
    const cafe = block(page, 'Square Enix Pop Up Cafe')
    const shortBefore = Number((await suruga.locator('.itl-badge').first().textContent())!.match(/(\d+) min short/)![1])

    // At 15:30 (planned 15:06): Yellow Submarine runs 15:30–16:15, SURUGA-YA after it.
    await block(page, 'Yellow Submarine').locator('.itl-here').click()
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('📍 since 15:30')
    await expect(suruga).toHaveAttribute('data-start', String(t('16:15') + shinjukuToYokohama))
    await expect(cafe).toHaveAttribute('data-start', String(t('16:30'))) // fixed: never moves
    await expect(suruga.locator('.itl-badge').first()).toHaveText(`⚠️ Doesn't fit before 16:30 (${shortBefore + 24} min short)`)
    let stops = await savedDay(saves, (s) => s[0].actualStart === '15:30')
    expect(stops[0].actualEnd).toBeUndefined()

    // Leaving at 15:50: visited (muted, actual times), SURUGA-YA from 15:50.
    await setTestTime(page, '15:50')
    await block(page, 'Yellow Submarine').locator('.itl-leave').click()
    await expect(block(page, 'Yellow Submarine')).toHaveClass(/itl-visited/)
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('✓ 15:30–15:50')
    await expect(block(page, 'Yellow Submarine').locator('.itl-actions')).toHaveCount(0)
    await expect(suruga).toHaveAttribute('data-start', String(t('15:50') + shinjukuToYokohama))
    await expect(cafe).toHaveAttribute('data-start', String(t('16:30')))
    stops = await savedDay(saves, (s) => s[0].actualEnd === '15:50')
    expect(stops[0]).toMatchObject({ name: 'Yellow Submarine Shinjuku', actualStart: '15:30', actualEnd: '15:50' })
  })

  test('Leaving now without "I\'m here now" takes the planned start as the arrival', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, {}, '15:06', '&now=2026-12-05T15:40')
    await block(page, 'Yellow Submarine').locator('.itl-leave').click()
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('✓ 15:06–15:40')
    const stops = await savedDay(saves, (s) => s[0].actualEnd === '15:40')
    expect(stops[0]).toMatchObject({ actualStart: '15:06', actualEnd: '15:40' })
  })

  test('Reset day removes the actual times, after a confirmation', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, {}, '15:06', '&now=2026-12-05T15:30')
    await expect(page.locator('#itl-reset-day')).toBeHidden()
    await block(page, 'Yellow Submarine').locator('.itl-here').click()
    await expect(page.locator('#itl-reset-day')).toBeVisible()
    const messages: string[] = []
    page.once('dialog', (d) => { messages.push(d.message()); d.accept() })
    await page.locator('#itl-reset-day').click()
    await expect.poll(() => messages.length).toBe(1)
    expect(messages[0]).toBe('Reset the actual times for 5. des (lør)? The planned times are used again.')
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('15:06–15:51')
    await expect(page.locator('#itl-reset-day')).toBeHidden()
    const stops = await savedDay(saves, (s) => !s[0].actualStart)
    expect(stops[0].actualEnd).toBeUndefined()
  })

  test('Check day sends the actual times', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, {}, '15:06', '&now=2026-12-05T15:30')
    await block(page, 'Yellow Submarine').locator('.itl-here').click()
    let body: any = null
    await page.route('**/api/itinerary-review', async (route) => {
      body = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) })
    })
    await page.locator('#itl-check-btn').click()
    await expect.poll(() => body).toBeTruthy()
    expect(body.stops[0]).toMatchObject({ actualStart: '15:30', actualEnd: null })
    expect(body.stops[1]).toMatchObject({ actualStart: null, actualEnd: null })
  })
})

test.describe('/itinerary-list (the list) keeps what it doesn\'t use', () => {
  test('saving from the list keeps actualStart/actualEnd and other unknown fields on the stops', async ({ page }) => {
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto('/itinerary-list')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    const day = await page.evaluate(() => {
      // @ts-ignore - globals of the list's inline script
      const s = state[0].stops[0]
      s.actualStart = '10:05'; s.actualEnd = '10:40'; s.note = 'Own note'; s.somethingNew = { kept: true }
      // @ts-ignore
      render()
      // @ts-ignore
      return state[0].day
    })
    // An ordinary list edit: the day's start time.
    await page.locator('.day-start-input').first().fill('09:15')
    await page.locator('.day-start-input').first().dispatchEvent('change')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    const saved = saves[saves.length - 1].days[day]
    expect(saved.startTime).toBe('09:15')
    expect(saved.stops[0]).toMatchObject({ actualStart: '10:05', actualEnd: '10:40', note: 'Own note', somethingNew: { kept: true } })
  })
})

test.describe('/itinerary on a phone: finding "I\'m here now" / "Leaving now"', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  // A trip from 1 December, with the Yokohama stops on its first day.
  const DEC_1 = { firstTokyoDay: '2026-12-01', lastTokyoDay: '2026-12-03' }
  // The whole button inside its block's box — the block cuts off whatever overflows it.
  async function expectInsideBlock(blockEl: ReturnType<Page['locator']>, button: ReturnType<Page['locator']>) {
    const b = (await blockEl.boundingBox())!
    const r = (await button.boundingBox())!
    expect(r.y).toBeGreaterThanOrEqual(b.y)
    expect(r.y + r.height).toBeLessThanOrEqual(b.y + b.height + 0.5)
    expect(r.x + r.width).toBeLessThanOrEqual(b.x + b.width + 0.5)
  }

  test('with ?now=2026-12-01T13:00 on the 1 December tab: on every block, fully visible; not on other days', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, DEC_1, '15:06', '&now=2026-12-01T13:00')
    await expect(page.locator('.itl-tab.active')).toHaveText('1. des (tir)')
    for (const name of ['Yellow Submarine', 'SURUGA-YA', 'Square Enix Pop Up Cafe', 'Tokyo Temple']) {
      const b = block(page, name)
      await expect(b.locator('.itl-here')).toBeVisible()
      await expect(b.locator('.itl-leave')).toBeVisible()
      await expectInsideBlock(b, b.locator('.itl-here'))
      await expectInsideBlock(b, b.locator('.itl-leave'))
    }
    await page.locator('.itl-tab', { hasText: '2. des' }).click()
    await expect(page.locator('.itl-grid')).toBeVisible()
    await expect(page.locator('.itl-here, .itl-leave')).toHaveCount(0)
  })

  test('without a test time, before the trip: no buttons, on the block or in the sheet', async ({ page, sanity, trackDoc }) => {
    await page.clock.setFixedTime(new Date('2026-11-03T12:00:00+09:00'))
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, DEC_1)
    await expect(page.locator('#itl-test-time')).toBeHidden()
    await expect(page.locator('.itl-here, .itl-leave')).toHaveCount(0)
    await block(page, 'Yellow Submarine').click()
    await expect(page.locator('#itl-detail')).toBeVisible()
    await expect(page.locator('#itl-ed-now')).toBeHidden()
  })

  // "🧪 Test time" set from the toolbar, as on the phone.
  async function setTestTimeInUi(page: Page, date: string, hhmm: string) {
    await page.locator('#itl-test-btn').click()
    await page.locator('#itl-test-date').selectOption(date)
    await page.locator('#itl-test-clock').fill(hhmm)
    await page.locator('#itl-test-set').click()
    await expect(page.locator('#itl-test-time')).toContainText(`${date} ${hhmm}`)
  }
  const sized = (min: number) => ({ name: `Sized ${min} Stop`, hours: '10:00–20:00', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: min })
  const savedStop = async (saves: any[], i: number, check: (s: any) => boolean) =>
    expect.poll(() => saves.length > 0 && check(saves[saves.length - 1].days['2026-12-01'].stops[i]), { timeout: 10000 }).toBe(true)

  test('a 10-minute block with a Tokyo test time: 📍 on its first line, tapped without the sheet, then ✅', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 9.6 s alone; much slower under 4 parallel workers
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { ...sized(10), name: 'Ten Min Stop', travelMin: 0, travelFrom: '__base__' }, sized(60),
    ], DEC_1, '10:00')
    await setTestTimeInUi(page, '2026-12-01', '09:50')
    const b = block(page, 'Ten Min Stop')
    await expect(b).toHaveClass(/itl-compact/)
    const icons = b.locator('.itl-first .itl-icons')
    await expect(icons.locator('.itl-here')).toHaveText('📍')
    await expect(b.locator('.itl-leave')).toHaveCount(0) // one at a time: ✅ after "I'm here now"
    await expectInsideBlock(b, icons.locator('.itl-here'))
    await icons.locator('.itl-here').click()
    await expect(page.locator('#itl-detail')).toBeHidden() // not the sheet
    await savedStop(saves, 0, (s) => s.actualStart === '09:50')
    await expect(b.locator('.itl-first .itl-icons .itl-leave')).toHaveText('✅')
    await expect(b.locator('.itl-here')).toHaveCount(0)
    await b.locator('.itl-first .itl-icons .itl-leave').click()
    await expect(page.locator('#itl-detail')).toBeHidden()
    await savedStop(saves, 0, (s) => s.actualEnd === '09:50')
    await expect(b.locator('.itl-here, .itl-leave')).toHaveCount(0) // left: nothing more to press
  })

  test('both buttons on today\'s blocks of every size, at the default and the smallest zoom (compact: the icon)', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 12.4 s alone; much slower under 4 parallel workers
    const SIZES = [10, 20, 30, 45, 60, 120]
    await openTimeline(page, sanity, trackDoc, SIZES.map((m, i) => (i ? sized(m) : { ...sized(m), travelMin: 0, travelFrom: '__base__' })), DEC_1, '10:00')
    await setTestTimeInUi(page, '2026-12-01', '09:00')
    const check = async () => {
      for (const m of SIZES) {
        const b = block(page, `Sized ${m} Stop`)
        await expect(b.locator('.itl-here')).toBeVisible()
        await expectInsideBlock(b, b.locator('.itl-here'))
        if (await b.evaluate((el) => el.classList.contains('itl-compact') && !el.querySelector('.itl-actions'))) continue // the 📍 icon only
        await expect(b.locator('.itl-leave')).toBeVisible()
        await expectInsideBlock(b, b.locator('.itl-leave'))
      }
    }
    await check()
    await expect(block(page, 'Sized 10 Stop')).toHaveClass(/itl-compact/)
    await expect(block(page, 'Sized 120 Stop').locator('.itl-actions .itl-leave')).toHaveText('✅ Leaving now')
    while (await page.locator('#itl-zoom-out').isEnabled()) await page.locator('#itl-zoom-out').click()
    await check()
  })

  test('the "now" stop is highlighted on today: the one on now, then the next, then the one you\'re at; not on other days', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { ...sized(60), name: 'Now A', travelMin: 0, travelFrom: '__base__' }, { ...sized(60), name: 'Now B' }, { ...sized(60), name: 'Now C' },
    ], DEC_1, '10:00', '&now=2026-12-01T10:30')
    const lit = page.locator('.itl-block.itl-now-block')
    await expect(lit).toHaveCount(1)
    await expect(lit.locator('.itl-name')).toHaveText('Now A') // 10:00–11:00
    await block(page, 'Now A').locator('.itl-leave').click() // left early
    await expect(lit.locator('.itl-name')).toHaveText('Now B') // the next one
    await block(page, 'Now B').locator('.itl-here').click()
    await expect(lit.locator('.itl-name')).toHaveText('Now B') // there now
    await expect(block(page, 'Now C')).not.toHaveClass(/itl-now-block/)
    await page.locator('.itl-tab', { hasText: '2. des' }).click()
    await expect(page.locator('.itl-grid')).toBeVisible()
    await expect(lit).toHaveCount(0)
  })

  test('the toolbar hint: outside the trip with the real clock; gone with a test time or on a trip day', async ({ page, sanity, trackDoc }) => {
    const hint = page.locator('#itl-here-hint')
    await page.clock.setFixedTime(new Date('2026-11-03T12:00:00+09:00'))
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, DEC_1)
    await expect(hint).toHaveText('I\'m here now appears on trip days. Use 🧪 Test time to try it.')
    await setTestTimeInUi(page, '2026-12-01', '13:00')
    await expect(hint).toBeHidden()
    await page.locator('#itl-test-clear').click()
    await expect(hint).toBeVisible()
  })

  test('the toolbar hint is not shown on a trip day', async ({ page, sanity, trackDoc }) => {
    await page.clock.setFixedTime(new Date('2026-12-01T12:00:00+09:00'))
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, DEC_1)
    await expect(page.locator('#itl-test-time')).toBeHidden()
    await expect(page.locator('#itl-here-hint')).toBeHidden()
    await expect(page.locator('.itl-here').first()).toBeVisible()
  })

  test('in the edit sheet: both on today\'s stop, saved like the block\'s; hidden on other days', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 8.0 s alone; much slower under 4 parallel workers
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, DEC_1, '15:06', '&now=2026-12-01T13:00')
    await block(page, 'Yellow Submarine').click()
    await expect(page.locator('#itl-ed-here')).toBeVisible()
    await expect(page.locator('#itl-ed-leave')).toBeVisible()
    await page.locator('#itl-ed-here').click()
    await expect(page.locator('#itl-ed-here')).toBeHidden() // got there
    await expect(page.locator('#itl-ed-leave')).toBeVisible()
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('📍 since 13:00')
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-01'].stops[0].actualStart === '13:00', { timeout: 10000 }).toBe(true)
    await page.locator('#itl-ed-leave').click()
    await expect(page.locator('#itl-ed-now')).toBeHidden() // left: nothing more to press
    await expect(page.locator('#itl-detail')).toBeVisible() // still on the stop
    await expect.poll(() => saves[saves.length - 1].days['2026-12-01'].stops[0], { timeout: 10000 }).toMatchObject({ actualStart: '13:00', actualEnd: '13:00' })

    await page.locator('#itl-detail-close').click()
    await page.locator('.itl-tab', { hasText: '2. des' }).click()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook: one stop on 2 December
      const itl = window.__itl
      itl.state[1].stops = [{ name: 'Other Day Shop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 }]
      itl.render()
    })
    await block(page, 'Other Day Shop').click()
    await expect(page.locator('#itl-detail')).toBeVisible()
    await expect(page.locator('#itl-ed-now')).toBeHidden()
  })
})

test('on a phone, two overlapping 30-min stops side by side still show both buttons in full', async ({ page, sanity, trackDoc }) => {
  await openTimeline(page, sanity, trackDoc, [
    { name: 'Narrow A', hours: '10:00–20:00', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, travelMin: 0, travelFrom: '__base__' },
    { name: 'Narrow B', hours: '10:00–20:00', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, fixedTime: '10:15' },
  ], { firstTokyoDay: '2026-12-01', lastTokyoDay: '2026-12-03' }, '10:00', '&now=2026-12-01T09:00')
  for (const name of ['Narrow A', 'Narrow B']) {
    const b = page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
    await expect(b).toHaveAttribute('data-cols', '2')
    const box = (await b.boundingBox())!
    for (const cls of ['.itl-here', '.itl-leave']) {
      const r = (await b.locator(cls).boundingBox())!
      expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    }
    await expect(b.locator('.itl-here')).toHaveAttribute('aria-label', "I'm here now")
  }
})

test.describe('/itinerary: the "🧪 Test time" control', () => {
  const putStops = (page: Page) => page.evaluate((stops) => {
    // @ts-ignore - the page's test hook
    const itl = window.__itl
    itl.state[0].stops = stops
    itl.state[0].startTime = '15:06'
    itl.render()
  }, YOKOHAMA_DAY)

  test('sets the same override as ?now= (kept in the address over a reload), and "Clear test time" ends it', async ({ page, sanity, trackDoc }) => {
    await page.clock.setFixedTime(new Date('2026-11-03T12:00:00+09:00')) // before the trip
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY, { firstTokyoDay: '2026-12-01', lastTokyoDay: '2026-12-03' })
    await expect(page.locator('#itl-test-time')).toBeHidden()
    await expect(page.locator('#itl-test-clear')).toBeHidden()
    await expect(page.locator('.itl-here')).toHaveCount(0)

    await page.locator('.itl-tab', { hasText: '3. des' }).click() // setting it opens that day
    await page.locator('#itl-test-btn').click()
    await expect(page.locator('#itl-test-date option')).toHaveText(['1. des (tir)', '2. des (ons)', '3. des (tor)'])
    await page.locator('#itl-test-date').selectOption('2026-12-01')
    await page.locator('#itl-test-clock').fill('13:00')
    await page.locator('#itl-test-set').click()
    await expect(page.locator('#itl-test-form')).toBeHidden()
    await expect(page.locator('#itl-test-time')).toContainText('🧪 Test time: 2026-12-01 13:00 (Tokyo)')
    await expect(page.locator('.itl-tab.active')).toHaveText('1. des (tir)')
    expect(new URL(page.url()).searchParams.get('now')).toBe('2026-12-01T13:00')
    await expect(page.locator('.itl-now')).toHaveAttribute('data-minutes', String(t('13:00')))
    await expect(page.locator('.itl-block').first().locator('.itl-here')).toBeVisible()
    await page.locator('.itl-tab', { hasText: '2. des' }).click()
    await expect(page.locator('.itl-here, .itl-leave')).toHaveCount(0) // not on other days
    await expect(page.locator('#itl-test-time')).toBeVisible() // stays on

    await page.reload()
    await expect(page.locator('#itl-test-time')).toContainText('2026-12-01 13:00')
    await expect(page.locator('#itl-test-clear')).toBeVisible()
    await page.locator('.itl-tab', { hasText: '1. des' }).click()
    await putStops(page)
    await expect(page.locator('.itl-block').first().locator('.itl-leave')).toBeVisible()

    await page.locator('#itl-test-clear').click()
    await expect(page.locator('#itl-test-time')).toBeHidden()
    await expect(page.locator('#itl-test-clear')).toBeHidden()
    expect(new URL(page.url()).searchParams.get('now')).toBeNull()
    await expect(page.locator('.itl-here, .itl-leave')).toHaveCount(0)
  })
})

test.describe('/itinerary: "⏰ Reminder"', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const icsOf = (href: string) => decodeURIComponent(href.slice('data:text/calendar;charset=utf-8,'.length)).replace(/\r\n /g, '')
  const withoutStamp = (ics: string) => ics.replace(/DTSTAMP:\d{8}T\d{6}Z/, 'DTSTAMP:x')

  test('on each block with a leave-by time and in its sheet: the same .ics as the list\'s', async ({ page, sanity, trackDoc }) => {
    const { trip } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    const links = page.locator('.itl-block .itn-reminder')
    // Every stop but the last has somewhere to go next.
    await expect(links).toHaveCount(3)
    const ys = block(page, 'Yellow Submarine')
    await expect(ys.locator('.itl-leaveby')).toHaveText(/^Leave by \d{2}:\d{2} ⏰ Reminder$/)
    const timeline = await links.evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href')!, download: a.getAttribute('download')! })))
    // The link opens the calendar, not the edit sheet.
    await ys.locator('.itn-reminder').dispatchEvent('click')
    await expect(page.locator('#itl-detail')).toBeHidden()
    await ys.click()
    const sheetLink = page.locator('#itl-detail-lines .itn-reminder')
    await expect(sheetLink).toHaveAttribute('download', timeline[0].download)
    expect(withoutStamp(icsOf((await sheetLink.getAttribute('href'))!))).toBe(withoutStamp(icsOf(timeline[0].href)))

    // The list, same trip and stops.
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((stops) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops = stops; state[0].startTime = '15:06'; render()
    }, YOKOHAMA_DAY)
    const list = await page.locator('.day-card').first().locator('.itn-reminder')
      .evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href')!, download: a.getAttribute('download')! })))
    expect(list.map((l) => l.download)).toEqual(timeline.map((l) => l.download))
    expect(list.map((l) => withoutStamp(icsOf(l.href)))).toEqual(timeline.map((l) => withoutStamp(icsOf(l.href))))
    const cafe = icsOf(timeline[2].href)
    expect(cafe).toMatch(/DTSTART;TZID=Asia\/Tokyo:20261205T\d{6}/)
    expect(cafe).toMatch(/SUMMARY:Leave Square Enix Pop Up Cafe Yokohama \d{2}:\d{2} JST → Tokyo Temple/)
  })
})

test.describe('itinerary: the linked shop\'s photos', () => {
  async function shopWithPhotos(sanity: any, trackDoc: (id: string) => void, uploadedAssets: string[]) {
    const asset = await sanity.assets.upload('image', uniquePng(), { filename: 'itinerary-strip-test.png' })
    uploadedAssets.push(asset._id)
    const photo = (key: string, caption?: string) => ({ _key: key, _type: 'image', asset: { _type: 'reference', _ref: asset._id }, ...(caption ? { caption } : {}) })
    const shop = await sanity.create({
      _type: 'shopNote', shopName: testName(`Strip Shop ${Date.now()}`), latitude: 35.7, longitude: 139.77,
      photos: [photo('s1', 'Floor guide'), photo('s2', '4F retro games'), photo('s3')],
    })
    trackDoc(shop._id)
    return shop
  }
  const stops = (shopId: string) => [
    { name: 'Strip Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, shopId, travelMin: 0, travelFrom: '__base__' },
    { name: 'No Shop Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60 },
  ]

  test('the timeline\'s edit sheet: a strip of small photos with captions; a tap opens the lightbox', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    test.setTimeout(60_000) // 8.6 s alone; much slower under 4 parallel workers
    const shop = await shopWithPhotos(sanity, trackDoc, uploadedAssets)
    await openTimeline(page, sanity, trackDoc, stops(shop._id), {}, '10:00')
    // The name: the middle of the block may be one of its row photos (lightbox).
    await page.locator('.itl-block .itl-name', { hasText: shop.shopName }).click()
    const strip = page.locator('#itl-ed-photos')
    await expect(strip).toBeVisible()
    await expect(strip.locator('.shop-photo img')).toHaveCount(3)
    await expect(strip.locator('figcaption')).toHaveText(['Floor guide', '4F retro games'])
    await expect(strip.locator('img').first()).toHaveAttribute('src', /^https:\/\/cdn\.sanity\.io\/images\/.+w=160&fit=max&auto=format$/)
    await expect(strip.locator('img').nth(2)).toHaveAttribute('alt', `${shop.shopName} photo`)
    await strip.locator('img').nth(1).click()
    await expect(page.locator('dialog.lb-dialog')).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /w=2000/)
    await page.locator('.lb-close').click()
    await expect(page.locator('#itl-detail')).toBeVisible() // the sheet stays open

    await page.locator('#itl-detail-close').click()
    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'No Shop Stop' }) }).click()
    await expect(page.locator('#itl-detail')).toBeVisible()
    await expect(strip).toBeHidden()
  })

  test('a tall block has a row of photos under its text (the shop\'s, then the newest finds), a short one none; a photo opens the lightbox, the rest the sheet', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    test.setTimeout(60_000) // 12.4 s alone; much slower under 4 parallel workers
    const shop = await shopWithPhotos(sanity, trackDoc, uploadedAssets)
    // A find with a photo at the same shop: after the shop's own photos.
    const asset = await sanity.assets.upload('image', uniquePng(), { filename: 'block-row-find.png' })
    uploadedAssets.push(asset._id)
    const price = await sanity.create({
      _type: 'priceEntry', productName: testName('Row Find'), jan: uniqueJan(), price: 2200, currency: 'JPY', sourceType: 'japanStore',
      shop: { _type: 'reference', _ref: shop._id, _weak: true }, status: 'considering', seenAt: '2026-11-03T10:00:00Z',
      image: { _type: 'image', asset: { _type: 'reference', _ref: asset._id } },
    })
    trackDoc(price._id)
    await openTimeline(page, sanity, trackDoc, [
      ...stops(shop._id), // 60 min each: 135 px at the default zoom
      { name: 'Short Row Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 20, shopId: shop._id }, // 45 px
    ], {}, '10:00')
    const blocks = page.locator('.itl-block')
    const tall = blocks.first()
    const row = tall.locator('.itl-photos')
    await expect(row).toBeVisible()
    await expect(row.locator('img')).toHaveCount(4)
    // The shop's three photos, then the find's.
    expect(await row.locator('img').evaluateAll((ims) => ims.map((i) => i.getAttribute('alt')))).toEqual(['Floor guide', '4F retro games', `${shop.shopName} photo`, price.productName])
    await expect(row.locator('img').first()).toHaveAttribute('src', /^https:\/\/cdn\.sanity\.io\/images\/.+w=96&fit=max&auto=format$/)
    // Small, under the text, each whole inside the row; the name line from the left edge.
    const first = (await tall.locator('.itl-first').boundingBox())!, rowBox = (await row.boundingBox())!, box = (await tall.boundingBox())!
    expect(rowBox.y).toBeGreaterThanOrEqual(first.y + first.height - 0.5)
    for (const img of await row.locator('img').all()) {
      const r = (await img.boundingBox())!
      expect(r.width).toBeLessThanOrEqual(37)
      expect(r.x + r.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5)
    }
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
    expect(first.x - box.x).toBeLessThan(14) // no room kept for a photo on the left
    // The short block for the same shop: none, and not made compact for it.
    const short = blocks.nth(2)
    await expect(short).toHaveAttribute('data-dur', '20')
    await expect(short.locator('.itl-photos')).toHaveCount(0)
    await expect(blocks.filter({ has: page.locator('.itl-name', { hasText: 'No Shop Stop' }) }).locator('.itl-photos')).toHaveCount(0)

    await row.locator('img').nth(3).click()
    await expect(page.locator('dialog.lb-dialog')).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /w=2000/)
    await page.locator('.lb-close').click()
    await expect(page.locator('#itl-detail')).toBeHidden() // the photo, not the sheet
    await tall.locator('.itl-name').click()
    await expect(page.locator('#itl-detail')).toBeVisible()
  })

  test('the place type before the name (🛍️ 🍜 🗼 📌; a shop without a type is a shop), in the sheet\'s title too; none for an unlinked stop', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 10.0 s alone; much slower under 4 parallel workers
    const types = ['shop', 'restaurant', 'sight', 'other', undefined]
    const shops = []
    for (const type of types) {
      const doc = await sanity.create({ _type: 'shopNote', shopName: testName(`Type ${type || 'none'} Place ${Date.now()}`), latitude: 35.7, longitude: 139.77, ...(type ? { placeType: type } : {}) })
      trackDoc(doc._id)
      shops.push(doc)
    }
    await openTimeline(page, sanity, trackDoc, [
      ...shops.map((sh) => ({ name: 'x', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, shopId: sh._id })),
      { name: 'Unlinked Type Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 },
    ], {}, '10:00')
    const block = (name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
    const expected = [['🛍️', 'Shop'], ['🍜', 'Restaurant'], ['🗼', 'Sight to see'], ['📌', 'Other'], ['🛍️', 'Shop']]
    for (let i = 0; i < shops.length; i++) {
      const icon = block(shops[i].shopName).locator('.itl-first .itl-type')
      await expect(icon).toHaveText(expected[i][0])
      await expect(icon).toHaveAttribute('aria-label', expected[i][1])
    }
    await expect(block('Unlinked Type Stop').locator('.itl-type')).toHaveCount(0)
    // The sheet's title.
    await block(shops[1].shopName).locator('.itl-name').click()
    await expect(page.locator('#itl-detail-name')).toHaveText(`🍜 ${shops[1].shopName}`)
    await page.locator('#itl-detail-close').click()
    await block('Unlinked Type Stop').locator('.itl-name').click()
    await expect(page.locator('#itl-detail-name')).toHaveText('Unlinked Type Stop')
    await expect(page.locator('#itl-detail-name .itl-type')).toHaveCount(0)
  })

  test('the list\'s ⋯ panel shows the same strip', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const shop = await shopWithPhotos(sanity, trackDoc, uploadedAssets)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto('/itinerary-list')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((s) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops = s; render()
    }, stops(shop._id))
    const card = page.locator('.day-card').first()
    await card.locator('.more-btn').first().click()
    const panel = card.locator('.mc-panel.open')
    await expect(panel.locator('.shop-photo-strip figcaption')).toHaveText(['Floor guide', '4F retro games'])
    await panel.locator('.shop-photo img').first().click()
    await expect(page.locator('dialog.lb-dialog')).toBeVisible()
    await page.locator('.lb-close').click()
    await expect(panel).toBeVisible() // still open
    // A stop without a shop: no strip.
    await card.locator('.more-btn').nth(1).click()
    await expect(card.locator('.mc-panel.open')).toHaveCount(2)
    await expect(card.locator('.mc-panel.open').nth(1).locator('.shop-photo-strip')).toHaveCount(0)
  })
})

test.describe('/itinerary: the edit sheet\'s shop link', () => {
  test('the linked shop\'s name opens its page, whose "← Back to timeline" returns to the same day; an unlinked stop has no link', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 8.9 s alone; much slower under 4 parallel workers
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Sheet Link Shop ${Date.now()}`), latitude: 35.7, longitude: 139.77 })
    trackDoc(shop._id)
    const { trip } = await openTimeline(page, sanity, trackDoc, [])
    // The second day, so "the same day" isn't just the first one.
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await page.evaluate((shopId) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[1].stops = [
        { name: 'Linked', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, shopId, travelMin: 0, travelFrom: '__base__' },
        { name: 'Not Linked Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60 },
      ]
      itl.render()
    }, shop._id)

    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Not Linked Stop' }) }).click()
    await expect(page.locator('#itl-detail-name')).toHaveText('Not Linked Stop')
    await expect(page.locator('#itl-detail-shop')).toHaveCount(0)
    await page.locator('#itl-detail-close').click()

    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: shop.shopName }) }).click()
    const link = page.locator('#itl-detail-shop')
    await expect(link).toHaveText(shop.shopName)
    await expect(link).toHaveAttribute('href', `/edit-store?id=${shop._id}&from=timeline&day=2026-12-06&trip=${trip._id}`)
    await link.click()
    await expect(page.getByRole('heading', { name: 'Edit shop' })).toBeVisible()
    const back = page.locator('#s-back-timeline')
    await expect(back).toHaveText('← Back to timeline')
    await expect(back).toHaveAttribute('href', `/itinerary?day=2026-12-06&trip=${trip._id}`)
    await back.click()
    await expect(page.locator('.itl-tab.active')).toHaveText('6. des (søn)')
  })

  test('the shop page without ?from=timeline keeps "← Back to notes" only', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`No Back Shop ${Date.now()}`) })
    trackDoc(shop._id)
    await page.goto(`/edit-store?id=${shop._id}&day=2026-12-06`)
    await expect(page.locator('#s-back-timeline')).toHaveCount(0)
    await expect(page.locator('a.back-link')).toHaveText('← Back to notes')
    // A made-up day or trip never ends up in the link.
    await page.goto(`/edit-store?id=${shop._id}&from=timeline&day=tomorrow&trip=${encodeURIComponent('"><x')}`)
    await expect(page.locator('#s-back-timeline')).toHaveAttribute('href', '/itinerary')
  })
})

test.describe('/itinerary: "Found here" in the edit sheet, and the empty states', () => {
  const ref = (id: string, weak = false) => ({ _type: 'reference', _ref: id, ...(weak ? { _weak: true } : {}) })
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const stop = (name: string, shopId?: string) => ({ name, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, ...(shopId ? { shopId } : {}) })

  test('the shop\'s finds as a strip (photo, name, price, status; lightbox on the photo); "No shop photos yet" with a link; nothing for an unlinked stop', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    test.setTimeout(60_000) // 14.9 s alone; much slower under 4 parallel workers
    const asset = await sanity.assets.upload('image', uniquePng(), { filename: 'found-strip-test.png' })
    uploadedAssets.push(asset._id)
    const withFinds = await sanity.create({ _type: 'shopNote', shopName: testName(`Finds Shop ${Date.now()}`), latitude: 35.7, longitude: 139.77 })
    const bare = await sanity.create({ _type: 'shopNote', shopName: testName(`Bare Strip Shop ${Date.now()}`), latitude: 35.7, longitude: 139.77 })
    const price = await sanity.create({
      _type: 'priceEntry', productName: testName('Strip Find'), jan: uniqueJan(), price: 5980, currency: 'JPY', sourceType: 'japanStore',
      shop: ref(withFinds._id, true), status: 'considering', seenAt: '2026-11-03T10:00:00Z', image: { _type: 'image', asset: ref(asset._id) },
    })
    const planned = await sanity.create({ _type: 'familyPurchase', person: 'Kim', name: testName('Strip Planned'), store: ref(withFinds._id), status: 'planned', purchaseDate: '2026-11-01', priceYen: 1500 })
    for (const d of [withFinds, bare, price, planned]) trackDoc(d._id)

    const { trip } = await openTimeline(page, sanity, trackDoc, [stop('A', withFinds._id), stop('B', bare._id), stop('Unlinked Strip Stop')], {}, '10:00')

    // The shop with finds (and no photos).
    await block(page, withFinds.shopName).locator('.itl-name').click() // not the photo row
    const found = page.locator('#itl-ed-found')
    await expect(found).toBeVisible()
    await expect(found.locator('.itl-strip-title')).toHaveText('🔎 Found here')
    await expect(found.locator('.found-name')).toHaveText([price.productName, planned.name]) // newest first
    await expect(found.locator('.found-status')).toHaveText(['🤔 Considering', '🛒 Planned'])
    await expect(found.locator('.found-item').first().locator('.found-price')).toHaveText(/¥5\s980/)
    await expect(found.locator('.found-item').nth(1).locator('.found-none')).toBeVisible() // no photo
    await found.locator('img').first().click()
    await expect(page.locator('dialog.lb-dialog')).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /w=2000/)
    await page.locator('.lb-close').click()
    await expect(page.locator('#itl-ed-photos')).toBeHidden()
    const empty = page.locator('#itl-ed-photos-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('No shop photos yet')
    await expect(empty.locator('a')).toHaveAttribute('href', `/edit-store?id=${withFinds._id}&from=timeline&day=2026-12-05&trip=${trip._id}#shop-photos`)
    await page.locator('#itl-detail-close').click()

    // A shop with nothing found: no "Found here" strip.
    await block(page, bare.shopName).click()
    await expect(page.locator('#itl-detail-name')).toHaveText(`🛍️ ${bare.shopName}`)
    await expect(found).toBeHidden()
    await expect(empty).toBeVisible()
    await page.locator('#itl-detail-close').click()

    // Not linked to a shop: none of it.
    await block(page, 'Unlinked Strip Stop').click()
    await expect(page.locator('#itl-detail-name')).toHaveText('Unlinked Strip Stop')
    await expect(found).toBeHidden()
    await expect(empty).toBeHidden()
    await expect(page.locator('#itl-ed-photos')).toBeHidden()
  })
})

test.describe('/itinerary: the edit sheet\'s size', () => {
  async function openSheet(page: Page, sanity: any, trackDoc: (id: string) => void) {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await page.locator('.itl-block').first().click()
    const sheet = page.locator('#itl-detail')
    await expect(sheet).toBeVisible()
    return sheet
  }
  const padding = (sheet: ReturnType<Page['locator']>) => sheet.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) }
  })

  test.describe('on a desktop screen', () => {
    test.use({ viewport: { width: 1280, height: 800 } })
    test('at most 640 px wide, centred, with padding inside', async ({ page, sanity, trackDoc }) => {
      const sheet = await openSheet(page, sanity, trackDoc)
      const box = (await sheet.boundingBox())!
      expect(box.width).toBe(640)
      expect(Math.abs(box.x - (1280 - box.x - box.width))).toBeLessThanOrEqual(1) // as much room left as right
      expect(box.x).toBeGreaterThan(300)
      const pad = await padding(sheet)
      expect(pad.left).toBeGreaterThanOrEqual(20)
      expect(pad.right).toBeGreaterThanOrEqual(20)
    })
  })

  test('on the phone: the full width, with padding inside', async ({ page, sanity, trackDoc }) => {
    const sheet = await openSheet(page, sanity, trackDoc)
    const box = (await sheet.boundingBox())!
    const width = page.viewportSize()!.width
    expect(box.x).toBe(0)
    expect(box.width).toBe(width)
    expect((await padding(sheet)).left).toBeGreaterThanOrEqual(16)
  })
})

test.describe('the itinerary\'s addresses: /itinerary is the timeline, /itinerary-list the list', () => {
  test('/itinerary renders the timeline and /itinerary-list the list', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Routes Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await expect(page.locator('.itl-tab')).toHaveText(['5. des (lør)', '6. des (søn)'])
    await expect(page.locator('.day-card')).toHaveCount(0)

    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await expect(page.locator('#itn-timeline-link')).toBeVisible()
    await expect(page.locator('.itl-grid')).toHaveCount(0)
  })

  test('/itinerary-timeline redirects to /itinerary, keeping ?trip, ?now and ?day', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Redirect Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    const res = await page.request.get(`/itinerary-timeline?trip=${trip._id}&now=2026-12-06T13:00&day=2026-12-06`, { maxRedirects: 0 })
    expect(res.status()).toBe(302)
    expect(res.headers()['location']).toBe(`/itinerary?trip=${trip._id}&now=2026-12-06T13:00&day=2026-12-06`)

    await page.goto(`/itinerary-timeline?trip=${trip._id}&now=2026-12-06T13:00&day=2026-12-06`)
    await expect(page).toHaveURL(`/itinerary?trip=${trip._id}&now=2026-12-06T13:00&day=2026-12-06`)
    await expect(page.locator('.itl-tab.active')).toHaveText('6. des (søn)')
    await expect(page.locator('#itl-test-time')).toContainText('2026-12-06 13:00')
    // Without a query too. (The browser then goes on to the trip it remembers — TripSwitch.)
    const bare = await page.request.get('/itinerary-timeline', { maxRedirects: 0 })
    expect(bare.status()).toBe(302)
    expect(bare.headers()['location']).toBe('/itinerary')
  })

  test('the site navigation\'s Plan goes to /itinerary, and is lit on both pages', async ({ page }) => {
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto('/itinerary-list')
    const plan = page.locator('nav a', { hasText: 'Plan' })
    await expect(plan.first()).toHaveAttribute('href', '/itinerary')
    for (const link of await plan.all()) await expect(link).toHaveClass(/active/)
    await page.goto('/itinerary')
    for (const link of await plan.all()) await expect(link).toHaveClass(/active/)
  })
})

test.describe('/itinerary: "Found here" — the name opens the price, and "✅ Bought"', () => {
  const ref = (id: string, weak = false) => ({ _type: 'reference', _ref: id, ...(weak ? { _weak: true } : {}) })
  const BUDGET = { childBudgets: [{ _key: 'kim', person: 'Kim', budgetNok: 5000, budgetYen: 50000 }] }
  const shopStop = (shopId: string) => ({ name: 'Bought Shop Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, shopId, travelMin: 0, travelFrom: '__base__' })
  const item = (page: Page, name: string) => page.locator('#itl-ed-found .found-item').filter({ has: page.locator('.found-name', { hasText: name }) })
  async function shopWith(sanity: any, trackDoc: (id: string) => void, prices: Record<string, unknown>[]) {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Bought Shop ${Date.now()}`), latitude: 35.7, longitude: 139.77 })
    trackDoc(shop._id)
    const docs = []
    for (const p of prices) {
      const d = await sanity.create({
        _type: 'priceEntry', jan: uniqueJan(), currency: 'JPY', sourceType: 'japanStore', shop: ref(shop._id, true),
        status: 'considering', seenAt: '2026-11-03T10:00:00Z', category: 'album', condition: 'new', ...p,
      })
      trackDoc(d._id)
      docs.push(d)
    }
    return { shop, docs }
  }
  const openSheet = async (page: Page, shopName: string) => {
    await page.locator('.itl-block .itl-name', { hasText: shopName }).click() // not the photo row
    await expect(page.locator('#itl-ed-found')).toBeVisible()
  }

  test('the name opens /edit-price, whose "← Back to timeline" returns to the same day', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 10.1 s alone; much slower under 4 parallel workers
    const { shop, docs: [price] } = await shopWith(sanity, trackDoc, [{ productName: testName('Linked Find'), price: 1200 }])
    const { trip } = await openTimeline(page, sanity, trackDoc, [])
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await page.evaluate((s) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; itl.state[1].stops = [s]; itl.render()
    }, shopStop(shop._id))
    await openSheet(page, shop.shopName)
    const link = item(page, price.productName).locator('a.found-link')
    await expect(link).toHaveAttribute('href', `/edit-price?id=${price._id}&from=timeline&day=2026-12-06&trip=${trip._id}`)
    await link.click()
    await expect(page.getByRole('heading', { name: 'Edit price' })).toBeVisible()
    const back = page.locator('#p-back-timeline')
    await expect(back).toHaveText('← Back to timeline')
    await expect(back).toHaveAttribute('href', `/itinerary?day=2026-12-06&trip=${trip._id}`)
    await back.click()
    await expect(page.locator('.itl-tab.active')).toHaveText('6. des (søn)')
  })

  test('the panel\'s defaults, and Confirm marks it bought exactly like /edit-price — the strip updates without a reload', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 14.7 s alone; much slower under 4 parallel workers
    // Two identical prices: one bought here, the twin on /edit-price; the results must match.
    const same = { price: 5980, extraCost: 500, condition: 'used', note: 'Signed copy', taxIncluded: true }
    const { shop, docs: [here, twin] } = await shopWith(sanity, trackDoc, [
      { productName: testName('Bought Here'), ...same },
      { productName: testName('Bought Twin'), ...same, seenAt: '2026-11-02T10:00:00Z' },
    ])
    const { trip } = await openTimeline(page, sanity, trackDoc, [shopStop(shop._id)], BUDGET, '10:00')
    await openSheet(page, shop.shopName)
    await page.evaluate(() => { (window as any).__noReload = true })

    await item(page, here.productName).locator('.found-buy').click()
    const panel = page.locator('#itl-bought')
    await expect(panel).toBeVisible()
    await expect(page.locator('#itl-bought-name')).toHaveText(here.productName)
    await expect(page.locator('#itl-bought-buyer')).toHaveValue('Kim')
    await expect(page.locator('#itl-bought-trip')).toHaveValue(trip._id) // this itinerary's trip (no last-used trip yet)
    await expect(page.locator('#itl-bought-addto')).toHaveValue('collection') // an album
    await expect(page.locator('#itl-bought-passport')).toHaveValue('Kim')
    await expect(page.locator('#itl-bought-passport-field')).toBeVisible() // Shop in Japan

    await page.locator('#itl-bought-confirm').click()
    await expect(panel).toBeHidden()
    await expect(item(page, here.productName).locator('.found-status')).toHaveText('✅ Bought')
    await expect(item(page, here.productName).locator('.found-buy')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__noReload)).toBe(true) // no reload

    const created = async (id: string) => {
      await expect.poll(async () => (await sanity.fetch(`*[_id == $id][0].status`, { id })), { timeout: 10000 }).toBe('bought')
      const e = await sanity.fetch(`*[_id == $id][0]{ status, buyer, price, currency, extraCost, condition, note, taxIncluded, "shopId": shop._ref, "tripId": trip._ref, "fp": createdFamilyPurchase._ref, "item": createdItem._ref }`, { id })
      trackDoc(e.fp); trackDoc(e.item)
      const strip = (d: any) => { const { _id, _rev, _createdAt, _updatedAt, name, title, barcode, ...rest } = d; return rest }
      return {
        entry: { ...e, fp: !!e.fp, item: !!e.item },
        fp: strip(await sanity.fetch(`*[_id == $id][0]`, { id: e.fp })),
        item: strip(await sanity.fetch(`*[_id == $id][0]`, { id: e.item })),
      }
    }
    const viaTimeline = await created(here._id)
    expect(viaTimeline.entry).toMatchObject({ status: 'bought', buyer: 'Kim', tripId: trip._id, fp: true, item: true, note: 'Signed copy', extraCost: 500, condition: 'used', shopId: shop._id })
    expect(viaTimeline.fp).toMatchObject({ _type: 'familyPurchase', person: 'Kim', status: 'bought', priceYen: 6480, passportHolder: 'Kim', store: { _ref: shop._id } })
    expect(viaTimeline.item).toMatchObject({ _type: 'album', status: 'owned', purchasePriceYen: 6480 })

    // The twin on /edit-price (its last-used trip is the one just used here).
    await page.goto(`/edit-price?id=${twin._id}`)
    await page.locator('#p-status').selectOption('bought')
    await expect(page.locator('#p-trip')).toHaveValue(trip._id)
    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices\?open=/)
    const viaEditPrice = await created(twin._id)
    expect(viaTimeline).toEqual(viaEditPrice)
  })

  test('the USD/EUR check: no request, the message, and it stays Considering; a server error is shown the same way', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 11.1 s alone; much slower under 4 parallel workers
    const { shop, docs: [usd, jpy] } = await shopWith(sanity, trackDoc, [
      { productName: testName('Dollar Find'), price: 40, currency: 'USD', sourceType: 'online', sourceName: 'Example Store', shop: undefined, category: 'other' },
      { productName: testName('Yen Find'), price: 1000 },
    ])
    // The online one isn't at the shop — put it there for the strip, as an online price with a shop can't be made in the app.
    await sanity.patch(usd._id).set({ shop: ref(shop._id, true) }).commit()
    let requests = 0
    await page.route('**/api/price-entry-update', async (route) => {
      requests++
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Kim has no budget line on this trip' }) })
    })
    await openTimeline(page, sanity, trackDoc, [shopStop(shop._id)], BUDGET, '10:00')
    await openSheet(page, shop.shopName)

    await item(page, usd.productName).locator('.found-buy').click()
    await expect(page.locator('#itl-bought-addto')).toHaveValue('other') // category "other"
    await expect(page.locator('#itl-bought-passport-field')).toBeHidden() // online: never with a passport
    await page.locator('#itl-bought-confirm').click()
    await expect(page.locator('#itl-bought-msg')).toHaveText('Mark as Bought requires the price to be in JPY or NOK. Please enter the price in NOK.')
    expect(requests).toBe(0)
    await expect(item(page, usd.productName).locator('.found-status')).toHaveText('🤔 Considering')

    await page.locator('#itl-bought-cancel').click()
    await item(page, jpy.productName).locator('.found-buy').click()
    await page.locator('#itl-bought-confirm').click()
    await expect(page.locator('#itl-bought-msg')).toHaveText('Kim has no budget line on this trip')
    expect(requests).toBe(1)
    await expect(item(page, jpy.productName).locator('.found-status')).toHaveText('🤔 Considering')
    await expect(item(page, jpy.productName).locator('.found-buy')).toBeVisible()
    expect(await sanity.fetch(`*[_id == $id][0].status`, { id: jpy._id })).toBe('considering')
  })

  test('no button on what is already bought: a bought price and a family purchase', async ({ page, sanity, trackDoc }) => {
    const { shop, docs: [boughtPrice] } = await shopWith(sanity, trackDoc, [{ productName: testName('Already Bought'), price: 900, status: 'bought' }])
    const purchase = await sanity.create({ _type: 'familyPurchase', person: 'Kim', name: testName('Bought Keyring'), store: ref(shop._id), status: 'bought', purchaseDate: '2026-11-02', priceYen: 800 })
    trackDoc(purchase._id)
    await openTimeline(page, sanity, trackDoc, [shopStop(shop._id)], {}, '10:00')
    await openSheet(page, shop.shopName)
    await expect(item(page, boughtPrice.productName).locator('.found-status')).toHaveText('✅ Bought')
    await expect(item(page, purchase.name).locator('.found-status')).toHaveText('✅ Bought')
    await expect(page.locator('#itl-ed-found .found-buy')).toHaveCount(0)
    await expect(item(page, purchase.name).locator('a')).toHaveCount(0) // a family purchase has no page
  })
})

test.describe('/itinerary on a phone: opening hours on the day\'s weekday', () => {
  // 5 December 2026 (the test trip's first day) is a Saturday, 6 December a Sunday.
  const at = (name: string, hours: string, fixedTime: string, dur: number, extra: Record<string, unknown> = {}) =>
    ({ name, hours, tag: '', slot: '', lat: 35.7, lng: 139.77, dur, fixedTime, ...extra })
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const sheetLines = async (page: Page, name: string) => {
    await block(page, name).click()
    await expect(page.locator('#itl-detail')).toBeVisible()
    const lines = await page.locator('#itl-detail-lines li').allTextContents()
    await page.locator('#itl-detail-close').click()
    return lines
  }
  // The badge is inside the block's visible box (a short block cuts off what overflows it).
  async function expectBadgeShown(page: Page, name: string, text: string) {
    const b = block(page, name)
    await expect(b).toHaveClass(/itl-warn-/) // a coloured edge (a timing warning's red wins over the hours' orange)
    const badge = b.locator('.itl-hours-badge')
    await expect(badge).toHaveText(text)
    const box = (await b.boundingBox())!, r = (await badge.boundingBox())!
    expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
  }

  test('arriving before opening, closing during the visit, after closing: badge on the block, full message in the sheet', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      at('Early Shop', '11:00–20:00', '09:00', 30),
      at('BicCamera AKIBA', '10:00 - 22:00', '21:28', 40), // the real example
      at('Kamikaze Style Akihabara', '11:00–20:00', '22:13', 30), // the real example
    ], {}, '08:30')
    await expectBadgeShown(page, 'Early Shop', 'Opens 11:00')
    await expectBadgeShown(page, 'BicCamera AKIBA', 'Closes 22:00')
    await expectBadgeShown(page, 'Kamikaze Style', 'Closes 20:00')
    expect(await sheetLines(page, 'Early Shop')).toContain('⚠️ Opens 11:00 (you arrive 09:00)')
    expect(await sheetLines(page, 'BicCamera AKIBA')).toContain('⚠️ Closes 22:00 (you leave 22:08)')
    expect(await sheetLines(page, 'Kamikaze Style')).toContain('⚠️ Closes 20:00 (you arrive 22:13)')
    await expect(page.locator('.itl-block', { hasText: '~' })).toHaveCount(0) // no "Closed ~HH:MM?" any more
  })

  test('closed that weekday (English and Norwegian), and fine on another day', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      at('Closed Saturdays', '10:00–20:00, closed Sat', '12:00', 45),
      at('Norsk Butikk', 'man–fre 10:00–20:00, lør stengt', '14:00', 30),
    ], {}, '11:00')
    await expectBadgeShown(page, 'Closed Saturdays', 'Closed')
    await expectBadgeShown(page, 'Norsk Butikk', 'Closed')
    expect(await sheetLines(page, 'Closed Saturdays')).toContain('⚠️ Closed on Saturday')
    // The same stop on Sunday: open.
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[1].stops = [{ name: 'Sunday Shop', hours: '10:00–20:00, closed Sat', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 45, fixedTime: '12:00' }]
      itl.render()
    })
    await expect(block(page, 'Sunday Shop')).not.toHaveClass(/itl-warn-closed/)
    await expect(block(page, 'Sunday Shop').locator('.itl-hours-badge')).toHaveCount(0)
  })

  test('a linked shop\'s hours win over the stop\'s note; "Hours not understood" only for text meant as hours', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Hours Shop ${Date.now()}`), openingHours: '11:00 - 20:00', latitude: 35.7, longitude: 139.77 })
    trackDoc(shop._id)
    await openTimeline(page, sanity, trackDoc, [
      at('Linked', 'Lunsj · kontant', '09:00', 30, { shopId: shop._id }),
      at('Typo Hours', '10:00 - 8:30', '12:00', 30),
      at('Lunch Note', 'Lunsj · kontant', '13:00', 30),
    ], {}, '08:30')
    await expectBadgeShown(page, shop.shopName, 'Opens 11:00') // the shop's hours, not the note
    await expect(block(page, 'Typo Hours').locator('.itl-hours-note')).toHaveText('Hours not understood')
    await expect(block(page, 'Typo Hours')).not.toHaveClass(/itl-warn-closed/)
    await expect(block(page, 'Lunch Note').locator('.itl-hours-note')).toHaveCount(0)
    expect(await sheetLines(page, 'Typo Hours')).toContain('Hours not understood')
  })

  test('/itinerary-list shows the same messages', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Hours List Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((stops) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops = stops; state[0].startTime = '08:30'; render()
    }, [at('BicCamera AKIBA', '10:00 - 22:00', '21:28', 40), at('Closed Saturdays', '10:00–20:00, closed Sat', '12:00', 45), at('Typo Hours', '10:00 - 8:30', '14:00', 30)])
    const card = page.locator('.day-card').first()
    await expect(card.locator('.closed-warn')).toHaveText(['⚠️ Closes 22:00 (you leave 22:08)', '⚠️ Closed on Saturday'])
    await expect(card.locator('.hours-note')).toHaveText(['Hours not understood'])
  })
})

test.describe('/itinerary on a phone: the base at the start and end of the day', () => {
  const BASE_POINT = { lat: 35.697999, lng: 139.770830 } // lib/itinerary-page-data.ts BASE
  const YOKO = { lat: 35.464556, lng: 139.624649 }

  test('"🏠 Start: base" at the start time, the trip to the first stop, the trip back and "🏠 Back at base" — the same as the list', async ({ page, sanity, trackDoc }) => {
    const { trip } = await openTimeline(page, sanity, trackDoc, [
      { name: 'Far Shop', hours: '', tag: '', slot: '', ...YOKO, dur: 60 },
    ], {}, '10:00')
    const toFirst = estimateLeg(BASE_POINT, YOKO)!.minutes
    const back = estimateLeg(YOKO, BASE_POINT)!.minutes
    const end = t('10:00') + toFirst + 60 + back
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

    const grid = page.locator('.itl-grid')
    const start = Number(await grid.getAttribute('data-start'))
    const startLabel = page.locator('.itl-base-start')
    await expect(startLabel).toHaveText('🏠 Start: base · 10:00')
    await expect(startLabel).toHaveCSS('top', `${Math.round((t('10:00') - start) * PX_PER_MIN)}px`)
    await expect(page.locator('.itl-travel:not(.itl-travel-back)')).toHaveText([`🚆 ${toFirst} min`])
    const backLeg = page.locator('.itl-travel-back')
    await expect(backLeg).toHaveText(`🚆 ${back} min`)
    const endLabel = page.locator('.itl-base-end')
    await expect(endLabel).toHaveText(`🏠 Back at base ~${hhmm(end)}`)
    await expect(endLabel).toHaveCSS('top', `${Math.round((end - start) * PX_PER_MIN)}px`)
    // The trip back: no typed-in time (an estimate, as on the list) — only a train can be planned.
    await backLeg.click({ force: true })
    await expect(page.locator('#itl-train')).toBeVisible()
    await expect(page.locator('#itl-travel-edit .itn-travel-min')).toHaveCount(0)
    await expect(page.locator('#itl-travel-edit')).toHaveText(/^Estimated \d+ min$/)
    await page.locator('#itl-travel-editor-close').click()

    // The list: the same start and the same time back at the base.
    const stops = await page.evaluate(() => (window as any).__itl.state[0].stops)
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((s) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops = s; state[0].startTime = '10:00'; render()
    }, stops)
    const baseRows = page.locator('.day-card').first().locator('.stop.is-base')
    await expect(baseRows.first().locator('.stop-time')).toHaveText('10:00')
    await expect(baseRows.last().locator('.stop-time')).toHaveText(hhmm(end))
  })

  test('on the flight day, back at the base after the time to leave for the airport is flagged; Check day counts the trip back', async ({ page, sanity, trackDoc }) => {
    // Flight 23:00 from Narita: leave central Tokyo by 18:30. The last stop ends 18:10 near Yokohama, so you're back much later.
    await openTimeline(page, sanity, trackDoc, [], { flightHomeTime: '23:00', flightHomeAirport: 'Narita', flightHomeTerminal: 'T1' })
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await page.evaluate((p) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[1].stops = [{ name: 'Late Yokohama Shop', hours: '', tag: '', slot: '', ...p, dur: 60, fixedTime: '17:10' }]
      itl.render()
    }, YOKO)
    const endLabel = page.locator('.itl-base-end')
    await expect(endLabel).toHaveClass(/itl-base-late/)
    await expect(endLabel).toContainText('⚠️ after 18:30, when you must leave for Narita')

    const { flightDeadlineWarning } = await import('../src/lib/itinerary-review-helpers')
    const lastStop = { name: 'Late Yokohama Shop', plannedTime: t('17:10'), durationMin: 60, lat: YOKO.lat, lng: YOKO.lng }
    const backAt = t('18:10') + estimateLeg(YOKO, BASE_POINT)!.minutes
    const flight = { time: '23:00', airport: 'Narita', terminal: 'T1' }
    expect(flightDeadlineWarning([lastStop], flight)).toBeNull() // the stop alone ends 18:10 — fine
    expect(flightDeadlineWarning([lastStop], flight, backAt)!.message).toContain('The day ends back at the base at')
  })
})

test.describe('/itinerary on a phone: the day warning (a late train back, closed stops)', () => {
  // The real example: stops at 00:12 (DAISO, 10:00–22:00), 01:58 (Takadanobaba Mikado,
  // 10:00–23:30) and 03:03, back at the base at 03:48. No coordinates, so no travel time between
  // them — the times are exactly these.
  const LATE_DAY = [
    { name: 'Evening Stop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 132 },
    { name: 'DAISO', hours: '10:00–22:00', tag: '', slot: '', lat: null, lng: null, dur: 106 },
    { name: 'Takadanobaba Mikado', hours: '10:00–23:30', tag: '', slot: '', lat: null, lng: null, dur: 65 },
    { name: 'Last Stop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 45 },
  ]
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })

  test('the real late day: closed stops give the day warning, "After midnight" and closed badges, and moving one away', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, LATE_DAY, {}, '22:00')
    // The other day, with one stop ending 11:00.
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[1].stops = [{ name: 'Morning Stop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 60 }]
      itl.state[1].startTime = '10:00'
      itl.render()
    })
    const late = page.locator('#itl-late')
    // DAISO and Mikado are closed when you get there; no train back (no coordinates: no trip).
    await expect(late.locator('.itl-late-msg')).toHaveText(['⚠️ 2 stops are closed at the planned time.'])
    await expect(late.locator('.itl-late-name')).toHaveText(['DAISO · 00:12', 'Takadanobaba Mikado · 01:58'])
    await expect(late.locator('.itl-late-move').first().locator('option')).toHaveText(['Move to…', 'Sun 6 Dec, ends 11:00'])

    await expect(block(page, 'DAISO').locator('.itl-late-badge')).toHaveText('After midnight')
    await expect(block(page, 'DAISO').locator('.itl-hours-badge')).toHaveText('Closes 22:00')
    await expect(block(page, 'Takadanobaba Mikado').locator('.itl-late-badge')).toHaveText('After midnight')
    await expect(block(page, 'Takadanobaba Mikado').locator('.itl-hours-badge')).toHaveText('Closes 23:30')
    await expect(block(page, 'Evening Stop').locator('.itl-late-badge')).toHaveCount(0) // starts 22:00
    await expect(page.locator('.itl-base-end')).toHaveText('🏠 Back at base ~03:48')

    // Move DAISO to Sunday: it leaves the warning (Mikado, now at 00:12, is still closed) and it's saved there.
    await late.locator('.itl-late-item', { hasText: 'DAISO' }).locator('select').selectOption('2026-12-06')
    await expect(late.locator('.itl-late-msg')).toHaveText(['⚠️ 1 stop is closed at the planned time.'])
    await expect(late.locator('.itl-late-name')).toHaveText(['Takadanobaba Mikado · 00:12'])
    await expect(block(page, 'DAISO')).toHaveCount(0)
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-06'].stops.some((s: any) => s.name === 'DAISO'), { timeout: 10000 }).toBe(true)
    expect(saves[saves.length - 1].days['2026-12-05'].stops.map((s: any) => s.name)).toEqual(['Evening Stop', 'Takadanobaba Mikado', 'Last Stop'])
  })

  test('the last-train warning: a train after midnight, to a stop and back to the base', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Near Base', hours: '', tag: '', slot: '', lat: 35.697999, lng: 139.770830, dur: 40 },
      { name: 'Yokohama Night', hours: '', tag: '', slot: '', lat: 35.464556, lng: 139.624649, dur: 30 },
    ], {}, '23:30')
    await expect(block(page, 'Yokohama Night').locator('.itl-late-badge', { hasText: 'Last trains' })).toBeVisible()
    await expect(block(page, 'Near Base').locator('.itl-late-badge', { hasText: 'Last trains' })).toHaveCount(0) // a walk
    await expect(page.locator('.itl-base-end')).toContainText('🚆 Trains may not run (last trains around midnight)')
    await block(page, 'Yokohama Night').click()
    const lines = await page.locator('#itl-detail-lines li').allTextContents()
    expect(lines.some((l) => /^⚠️ The train here at 00:\d\d: Trains may not run \(last trains around midnight\)$/.test(l))).toBe(true)
    expect(lines.some((l) => l.startsWith('⚠️ The train back to the base at'))).toBe(true)
  })

  test('the same rules in Check day, the list and the "Next" banner', async ({ page, sanity, trackDoc }) => {
    const { dayWarningReviewItems, closedStopIndexes } = await import('../src/lib/itinerary-review-helpers')
    const { scheduleDay, nextLeave } = await import('../src/lib/itinerary-schedule')
    const inputs = LATE_DAY.map((s) => ({ name: s.name, lat: null, lng: null, durationMin: s.dur, fixedTime: null, arriveEarlyMin: null, manualTravelMin: null, noteTravelMin: null }))
    const sched = scheduleDay(inputs, t('22:00'), BASE)
    const closed = closedStopIndexes(LATE_DAY.map((s) => s.hours), 6, sched.stops.map((x) => ({ start: x.start, end: x.end })), '2026-12-05')
    expect(closed).toEqual([1, 2])
    expect(dayWarningReviewItems(LATE_DAY.map((s) => s.name), sched, closed)).toEqual([{
      severity: 'warning', stopIndex: null,
      message: '2 stops are closed at the planned time. (DAISO 00:12, Takadanobaba Mikado 01:58)',
      suggestion: 'Move them to another day.',
    }])
    // A leave-by after midnight is on the next date; a late train is passed on to the banner.
    const next = nextLeave([{ date: '2026-12-05', from: 'A', to: 'B', leaveBy: t('00:20') + 1440, lastTrain: true }], new Date('2026-12-06T00:10:00+09:00'))
    expect(next).toMatchObject({ date: '2026-12-06', leaveBy: t('00:20'), inMin: 10, lastTrain: true })

    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Late List Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((stops) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops = stops; state[0].startTime = '22:00'; render()
    }, LATE_DAY)
    await expect(page.locator('.day-card').first().locator('.day-late')).toHaveText(['⚠️ 2 stops are closed at the planned time.'])
  })
})

test.describe('/itinerary on a phone: when there is no day warning, and the late train back', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const AKIBA = { lat: 35.698917, lng: 139.774798 } // a walk from the base

  test('Don Quijote Akihabara (open 24 hours) at 23:07, walking back before the last trains: no day warning', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Don Quijote Akihabara', hours: 'Open 24 hours', tag: '', slot: '', ...AKIBA, dur: 45, fixedTime: '23:07' },
    ], {}, '22:30')
    await expect(block(page, 'Don Quijote')).toBeVisible()
    await expect(page.locator('#itl-late')).toBeHidden()
    await expect(block(page, 'Don Quijote').locator('.itl-hours-badge')).toHaveCount(0)
  })

  test('a train back to the base after the cut-off: the day warning with its time, and the stop that sets it', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Yokohama Late', hours: '', tag: '', slot: '', lat: 35.464556, lng: 139.624649, dur: 30, fixedTime: '23:50' },
    ], {}, '22:00')
    await expect(page.locator('#itl-late .itl-late-msg')).toHaveText(['⚠️ The trip back to the base leaves at 00:20. Trains may not run.'])
    await expect(page.locator('#itl-late .itl-late-name')).toHaveText(['Yokohama Late · 23:50'])
  })

  test('two stops closed at their planned time', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Too Early', hours: '11:00–20:00', tag: '', slot: '', lat: null, lng: null, dur: 30, fixedTime: '09:00' },
      { name: 'Open Then', hours: '10:00–20:00', tag: '', slot: '', lat: null, lng: null, dur: 30, fixedTime: '12:00' },
      { name: 'Closed Saturdays', hours: '10:00–20:00, closed Sat', tag: '', slot: '', lat: null, lng: null, dur: 30, fixedTime: '14:00' },
    ], {}, '08:30')
    await expect(page.locator('#itl-late .itl-late-msg')).toHaveText(['⚠️ 2 stops are closed at the planned time.'])
    await expect(page.locator('#itl-late .itl-late-name')).toHaveText(['Too Early · 09:00', 'Closed Saturdays · 14:00'])
  })
})

test.describe('/itinerary on a phone: areas', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })

  test('a linked shop\'s area on its block; a stop written by hand shows none', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Area Shop ${Date.now()}`), area: 'Akihabara', latitude: 35.7, longitude: 139.77 })
    trackDoc(shop._id)
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Linked', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, shopId: shop._id, travelMin: 0, travelFrom: '__base__' },
      { name: 'Hand Written Stop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30 },
    ], {}, '10:00')
    await expect(block(page, shop.shopName).locator('.itl-area')).toHaveText('📍 Akihabara')
    await expect(block(page, 'Hand Written Stop').locator('.itl-area')).toHaveCount(0)
  })
})

test.describe('/itinerary on a phone: the day\'s areas', () => {
  test('under the tabs, the areas in visiting order without repeats; the plan\'s own area when no stop has one', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 8.9 s alone; much slower under 4 parallel workers
    const mk = (name: string, area: string) => sanity.create({ _type: 'shopNote', shopName: testName(`${name} ${Date.now()}`), area, latitude: 35.7, longitude: 139.77 })
    const [a1, s1, a2, y1] = [await mk('Akiba One', 'Akihabara'), await mk('Shinjuku One', 'Shinjuku'), await mk('Akiba Two', 'Akihabara'), await mk('Yoko One', 'Yokohama')]
    for (const d of [a1, s1, a2, y1]) trackDoc(d._id)
    const linked = (id: string) => ({ name: 'x', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, shopId: id })
    await openTimeline(page, sanity, trackDoc, [
      linked(a1._id), linked(s1._id), { name: 'Lunch', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30 }, linked(a2._id), linked(y1._id),
    ], {}, '10:00')
    await expect(page.locator('#itl-day-areas')).toHaveText('Akihabara · Shinjuku · Yokohama')
    // A day whose stops have no area: the plan's area for that day, as the list shows it.
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[1].stops = [{ name: 'Hand Written', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30 }]
      itl.state[1].area = 'Nakano'
      itl.render()
    })
    await expect(page.locator('#itl-day-areas')).toHaveText('Nakano')
  })
})

test.describe('/itinerary on a phone: "⏰ Reminders for this day"', () => {
  const icsOf = (href: string) => decodeURIComponent(href.slice('data:text/calendar;charset=utf-8,'.length)).replace(/\r\n /g, '')
  const field = (ics: string, name: string) => [...ics.matchAll(new RegExp(`^${name}[:;](.*)$`, 'gm'))].map((m) => m[1].trim())
  // The events' start times (the time zone block has a DTSTART of its own).
  const starts = (ics: string) => field(ics, 'DTSTART').filter((v) => v.startsWith('TZID='))
  const SUMMARY_RE = /^Leave .+ \d{2}:\d{2} JST → .+$/

  test('every leave-by time, all checked; deselecting; one .ics with exactly the checked events and stable UIDs', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await page.locator('#itl-rem-btn').click()
    const panel = page.locator('#itl-reminders')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.itl-rem-note')).toHaveText('If you change the plan later, add the reminders again. Old ones stay in your calendar.')
    const items = panel.locator('.itl-rem-item')
    await expect(items).toHaveCount(3) // every stop but the last has a next stop
    const titles = await items.allTextContents()
    titles.forEach((tt) => expect(tt.trim()).toMatch(SUMMARY_RE))
    expect(titles[0].trim()).toMatch(/^Leave Yellow Submarine Shinjuku \d{2}:\d{2} JST → SURUGA-YA Marui City Yokohama$/)
    for (const c of await panel.locator('.itl-rem-check').all()) await expect(c).toBeChecked()

    // Uncheck the second: the file has the first and the third only, in the same format as one reminder.
    await panel.locator('.itl-rem-check').nth(1).uncheck()
    const add = page.locator('#itl-rem-add')
    await expect(add).toHaveAttribute('download', 'leave-reminders-2026-12-05.ics')
    let ics = icsOf((await add.getAttribute('href'))!)
    expect(field(ics, 'BEGIN').filter((v) => v === 'VEVENT')).toHaveLength(2)
    expect(field(ics, 'SUMMARY')).toEqual([titles[0].trim(), titles[2].trim()])
    expect(ics).toContain('TZID:Asia/Tokyo')
    expect(starts(ics)).toHaveLength(2)
    expect(starts(ics).every((v) => v.startsWith('TZID=Asia/Tokyo:20261205T'))).toBe(true)
    expect(field(ics, 'TRIGGER')).toEqual(['PT0M', 'PT0M'])
    expect(ics).toContain("DESCRIPTION:Times are Japan time (JST). Your calendar shows this in your phone's current time zone.")
    const uids = field(ics, 'UID')
    expect(uids).toEqual(['leave-20261205-yellow-submarine-shinjuku@final-fantasy-library', 'leave-20261205-square-enix-pop-up-cafe-yokoha@final-fantasy-library'])

    // Select none: nothing to add. Select all: all three.
    await panel.locator('#itl-rem-none').click()
    await expect(add).toHaveAttribute('aria-disabled', 'true')
    await panel.locator('#itl-rem-all').click()
    await expect(add).toHaveAttribute('aria-disabled', 'false')
    ics = icsOf((await add.getAttribute('href'))!)
    expect(field(ics, 'SUMMARY')).toHaveLength(3)

    // The plan changes (a longer first visit): the times move, the UIDs stay — and they're the
    // single "⏰ Reminder" link's too.
    await panel.locator('#itl-rem-close').click()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; itl.state[0].stops[0].dur = 75; itl.render()
    })
    await page.locator('#itl-rem-btn').click()
    const after = icsOf((await add.getAttribute('href'))!)
    expect(field(after, 'UID')).toEqual(field(ics, 'UID'))
    expect(starts(after)[0]).not.toBe(starts(ics)[0])
    const single = icsOf((await page.locator('.itl-block .itn-reminder').first().getAttribute('href'))!)
    expect(field(single, 'UID')).toEqual([field(after, 'UID')[0]])
    expect(field(single, 'SUMMARY')).toEqual([field(after, 'SUMMARY')[0]])
  })
})

test.describe('/itinerary on a phone: "🚪 Leave at"', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  // The real-style conflict: the cafe at 16:30 for two hours, then the temple, where you must
  // arrive by 18:30 (19:00, 30 min early) after a 45-min trip — leave the cafe by 17:35, not 18:30.
  const CAFE = 'Square Enix Pop Up Cafe Yokohama'
  const CONFLICT = [
    { name: CAFE, hours: '', tag: 'mat', slot: '', lat: 35.4658, lng: 139.6223, dur: 120, fixedTime: '16:30' },
    { name: 'Tokyo Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 120, fixedTime: '19:00', arriveEarly: 30, travelMin: 45, travelFrom: CAFE },
  ]
  const savedLeaveAt = (saves: any[], i: number, value: string) =>
    expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].stops[i].leaveAt, { timeout: 10000 }).toBe(value)

  test('"Latest: HH:MM" in the sheet: the latest leave time for the next fixed time; it sets "Leave at" and the warning goes', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, CONFLICT, {}, '15:00')
    const cafe = block(page, CAFE)
    await expect(cafe).toHaveClass(/itl-warn-leave/)
    await expect(cafe.locator('.itl-badge')).toHaveText(['⚠️ Leave 55 min earlier']) // 18:30 − 17:35
    await cafe.locator('.itl-name').click()
    const latest = page.locator('#itl-ed-latest')
    await expect(latest).toHaveText('Latest: 17:35')
    expect(await page.locator('#itl-detail-lines li').allTextContents()).toContain('You can stay until 17:35') // the same time
    await latest.click()
    await savedLeaveAt(saves, 0, '17:35')
    await expect(page.locator('#itl-ed-leaveat')).toHaveValue('17:35')
    await expect(cafe).not.toHaveClass(/itl-warn-leave/)
    await expect(cafe.locator('.itl-badge')).toHaveCount(0)
    await expect(cafe.locator('.itl-time')).toHaveText('📌 16:30 · until 17:35')
    // The temple: nothing fixed after it — no button.
    await page.locator('#itl-detail-close').click()
    await block(page, 'Tokyo Temple').locator('.itl-name').click()
    await expect(latest).toBeHidden()
  })

  test('"Fix: leave at HH:MM" on the block\'s "Leave N min earlier": one tap, no sheet; the warning goes', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, CONFLICT, {}, '15:00')
    const cafe = block(page, CAFE)
    const fix = cafe.locator('.itl-badges .itl-fix')
    await expect(fix).toHaveText('Fix: leave at 17:35')
    await fix.click()
    await expect(page.locator('#itl-detail')).toBeHidden()
    await savedLeaveAt(saves, 0, '17:35')
    await expect(cafe.locator('.itl-badge, .itl-fix')).toHaveCount(0)
    await expect(cafe).not.toHaveClass(/itl-warn-leave/)
  })

  test('"Fix: leave at HH:MM" on "Doesn\'t fit" in the sheet: on the stop that runs into the cafe', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { name: 'Yokohama Long Shop', hours: '', tag: '', slot: '', lat: 35.4658, lng: 139.6223, dur: 120, travelMin: 0, travelFrom: '__base__' }, // 15:00–17:00
      ...CONFLICT.map((x) => (x.name === CAFE ? { ...x, dur: 60 } : x)),
    ], {}, '15:00')
    const shop = block(page, 'Yokohama Long Shop')
    await expect(shop).toHaveClass(/itl-warn-fit/)
    await shop.locator('.itl-name').click()
    const fix = page.locator('#itl-detail-lines .itl-fix')
    await expect(fix).toHaveText(/^Fix: leave at 16:[0-2]\d$/) // 16:30 − a short walk − 10 min
    const time = (await fix.textContent())!.slice(-5)
    await expect(page.locator('#itl-ed-latest')).toHaveText(`Latest: ${time}`)
    await fix.click()
    await savedLeaveAt(saves, 0, time)
    await expect(shop).not.toHaveClass(/itl-warn-fit/)
    await expect(shop.locator('.itl-badge, .itl-fix')).toHaveCount(0)
    await expect(page.locator('#itl-detail-lines .itl-fix')).toHaveCount(0)
    await expect(page.locator('#itl-detail')).toBeVisible() // still on the stop
  })

  const shinjukuToYokohama = estimateLeg({ lat: 35.689356, lng: 139.697787 }, { lat: 35.464556, lng: 139.624649 })!.minutes
  const setLeave = async (page: Page, value: string) => {
    await page.locator('#itl-ed-leaveat').fill(value)
    await page.locator('#itl-ed-leaveat').dispatchEvent('change')
  }

  test('the engine: a leave time ends the visit, with a fixed time too; arriving after it is flagged and takes no time', async () => {
    const { scheduleDay } = await import('../src/lib/itinerary-schedule')
    const s = (name: string, extra: Record<string, unknown> = {}) => ({ name, lat: null, lng: null, durationMin: 45, fixedTime: null, arriveEarlyMin: null, manualTravelMin: null, noteTravelMin: null, ...extra })
    let d = scheduleDay([s('A', { leaveAt: t('10:20') }), s('B')], t('10:00'), BASE)
    expect(d.stops[0]).toMatchObject({ start: t('10:00'), end: t('10:20'), arrivesAfterLeave: null })
    expect(d.stops[1].start).toBe(t('10:20'))
    d = scheduleDay([s('A', { fixedTime: t('12:00'), leaveAt: t('13:30') }), s('B')], t('10:00'), BASE)
    expect(d.stops[0]).toMatchObject({ start: t('12:00'), end: t('13:30') })
    d = scheduleDay([s('A', { durationMin: 120 }), s('B', { leaveAt: t('11:00') }), s('C')], t('10:00'), BASE)
    expect(d.stops[1]).toMatchObject({ start: t('12:00'), end: t('12:00'), arrivesAfterLeave: t('11:00') })
    expect(d.stops[2].start).toBe(t('12:00'))
    // 01:00 for an evening visit is the next morning.
    d = scheduleDay([s('Late', { leaveAt: t('01:00') })], t('23:00'), BASE)
    expect(d.stops[0]).toMatchObject({ start: t('23:00'), end: t('01:00') + 1440, arrivesAfterLeave: null })
  })

  test('shortening and lengthening a visit moves the following blocks; the duration shows the computed minutes', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 8.2 s alone; much slower under 4 parallel workers
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    const suruga = block(page, 'SURUGA-YA')
    await block(page, 'Yellow Submarine').click()
    await setLeave(page, '15:30') // shorter than 45 min
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('15:06–15:30 · until 15:30')
    await expect(suruga).toHaveAttribute('data-start', String(t('15:30') + shinjukuToYokohama))
    await expect(page.locator('#itl-ed-dur')).toBeDisabled()
    await expect(page.locator('#itl-ed-dur')).toHaveValue('24')
    await setLeave(page, '16:00') // longer
    await expect(suruga).toHaveAttribute('data-start', String(t('16:00') + shinjukuToYokohama))
    await expect(page.locator('#itl-ed-dur')).toHaveValue('54')
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].stops[0].leaveAt, { timeout: 10000 }).toBe('16:00')
    // ✕ clears it: the duration is back.
    await page.locator('#itl-ed-leaveat-clear').click()
    await expect(page.locator('#itl-ed-dur')).toBeEnabled()
    await expect(page.locator('#itl-ed-dur')).toHaveValue('45')
    await expect(block(page, 'Yellow Submarine').locator('.itl-time')).toHaveText('15:06–15:51')
    await expect.poll(() => saves[saves.length - 1].days['2026-12-05'].stops[0].leaveAt, { timeout: 10000 }).toBeUndefined()
  })

  test('with a fixed time, and arriving after the leave time', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Long First', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 120 },
      { name: 'Pinned Visit', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30, fixedTime: '13:00', leaveAt: '14:15' },
      { name: 'Too Late', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30, leaveAt: '14:00' },
    ], {}, '10:00')
    await expect(block(page, 'Pinned Visit').locator('.itl-time')).toHaveText('📌 13:00 · until 14:15')
    await expect(block(page, 'Too Late')).toHaveAttribute('data-start', String(t('14:15')))
    // A visit of no length is the smallest block: one line, the warning as ⚠️ (in full in the sheet).
    await expect(block(page, 'Too Late').locator('.itl-icons .itl-icon')).toHaveAttribute('title', '⚠️ Arrives after your leave time (14:00)')
    await block(page, 'Too Late').click()
    expect(await page.locator('#itl-detail-lines li').allTextContents()).toContain('⚠️ Arrives after your leave time (14:00)')
    await expect(page.locator('#itl-ed-dur')).toHaveValue('0')
  })

  test('"Until closing" on the real Yodobashi case: 09:30–22:00, arriving 21:37, leaves at 22:00 and the warning goes', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { name: 'Yodobashi Camera Multimedia Akiba', hours: '09:30 - 22:00', tag: '', slot: '', lat: null, lng: null, dur: 45 },
    ], {}, '21:37')
    const b = block(page, 'Yodobashi')
    await expect(b.locator('.itl-hours-badge')).toHaveText('Closes 22:00')
    await b.click()
    const until = page.locator('#itl-ed-until-close')
    await expect(until).toHaveText('Until closing (22:00)')
    await until.click()
    await expect(page.locator('#itl-ed-leaveat')).toHaveValue('22:00')
    await expect(b.locator('.itl-time')).toHaveText('21:37–22:00 · until 22:00')
    await expect(b.locator('.itl-hours-badge')).toHaveCount(0)
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].stops[0].leaveAt, { timeout: 10000 }).toBe('22:00')
  })

  test('"Until closing" is hidden when the hours are unknown or open 24 hours', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Always Open', hours: 'Open 24 hours', tag: '', slot: '', lat: null, lng: null, dur: 45 },
      { name: 'No Hours', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 45 },
    ], {}, '21:00')
    await block(page, 'Always Open').click()
    await expect(page.locator('#itl-ed-until-close')).toBeHidden()
    await page.locator('#itl-detail-close').click()
    await block(page, 'No Hours').click()
    await expect(page.locator('#itl-ed-until-close')).toBeHidden()
  })

  test('/itinerary-list keeps the leave time when it saves', async ({ page }) => {
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto('/itinerary-list')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    const day = await page.evaluate(() => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops[0].leaveAt = '12:30'; render(); return state[0].day
    })
    await page.locator('.day-start-input').first().fill('09:15')
    await page.locator('.day-start-input').first().dispatchEvent('change')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(saves[saves.length - 1].days[day].stops[0].leaveAt).toBe('12:30')
  })
})

test.describe('linking stops to shops (lib/stop-linking.ts)', () => {
  test('exact and close name matches, never across clearly different names; the diagnosis', async () => {
    const { nameMatch, suggestShop, linkSuggestions, linkDiagnosis } = await import('../src/lib/stop-linking')
    expect(nameMatch('🍜 Super Potato', 'Super potato')).toEqual({ kind: 'exact', score: 1 })
    expect(nameMatch('AKIHABARA KOTOBUKIYA', 'Akihabara Kotobukiya')!.kind).toBe('exact')
    expect(nameMatch('Yellow Submarine RPG Shop', 'Yellow Submarine Akihabara RPG Shop')!.kind).toBe('close')
    expect(nameMatch('BOOKOFF Akihabara Ekimae', 'BOOKOFF Akihabara Ekimae Store')!.kind).toBe('close')
    expect(nameMatch('Yodobashi Camera Akiba', 'Yodobashi Camera Multimedia Akiba')!.kind).toBe('close')
    expect(nameMatch('Yellow Submarine Shinjuku', 'Yellow Submarine Akihabara RPG Shop')).toBeNull()
    expect(nameMatch('Animate', 'animate Ikebukuro Flagship Store')).toBeNull() // another branch
    expect(nameMatch('Lunch', 'Lunch Box Cafe Shinjuku')).toBeNull()
    const shops = [
      { _id: 's1', shopName: 'Super potato', area: 'Akihabara' },
      { _id: 's2', shopName: 'Yellow Submarine Akihabara RPG Shop', area: 'Akihabara' },
      { _id: 's3', shopName: 'Super Potato Outlet', area: 'Osaka' },
    ]
    expect(suggestShop('Super Potato', shops)).toMatchObject({ shop: { _id: 's1' }, kind: 'exact' })
    const days = [
      { day: '2026-12-01', stops: [{ name: 'Super Potato' }, { name: 'Linked', shopId: 's2' }, { name: 'Yellow Submarine RPG Shop' }, { name: '🍜 Tsujita' }, { name: 'Gone', shopId: 'deleted' }] },
    ]
    expect(linkSuggestions(days, shops).map((r) => [r.index, r.suggestion?.shop._id ?? null, r.suggestion?.kind ?? null])).toEqual([
      [0, 's1', 'exact'], [2, 's2', 'close'], [3, null, null], [4, null, null],
    ])
    expect(linkDiagnosis(days, shops)).toEqual([
      { day: '2026-12-01', name: 'Super Potato', linked: false, shopName: null, area: null, missingShop: false },
      { day: '2026-12-01', name: 'Linked', linked: true, shopName: 'Yellow Submarine Akihabara RPG Shop', area: 'Akihabara', missingShop: false },
      { day: '2026-12-01', name: 'Yellow Submarine RPG Shop', linked: false, shopName: null, area: null, missingShop: false },
      { day: '2026-12-01', name: '🍜 Tsujita', linked: false, shopName: null, area: null, missingShop: false },
      { day: '2026-12-01', name: 'Gone', linked: false, shopName: null, area: null, missingShop: true },
    ])
  })
})

test.describe('/itinerary on a phone: "🔗 Link stops to shops"', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const row = (page: Page, name: string) => page.locator('.itl-link-row').filter({ has: page.locator('.itl-link-name', { hasText: name }) })
  async function shops(sanity: any, trackDoc: (id: string) => void) {
    const r = Math.random().toString(36).slice(2, 7)
    const exact = await sanity.create({ _type: 'shopNote', shopName: testName(`Kumo${r} Games`), area: 'Akihabara', latitude: 35.7, longitude: 139.77 })
    const close = await sanity.create({ _type: 'shopNote', shopName: testName(`Zebra${r} Retro Games Akihabara`), area: 'Akihabara', latitude: 35.7, longitude: 139.77 })
    const other = await sanity.create({ _type: 'shopNote', shopName: testName(`Ocelot${r} Books`), area: 'Nakano', latitude: 35.7, longitude: 139.77 })
    for (const d of [exact, close, other]) trackDoc(d._id)
    return { r, exact, close, other }
  }
  const stop = (name: string) => ({ name, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 })

  test('the review list (exact ticked, close not, a picker per row); Link selected saves shopId and the area shows', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 10.3 s alone; much slower under 4 parallel workers
    const { r, exact, close, other } = await shops(sanity, trackDoc)
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { ...stop(exact.shopName), note: 'my own note' },
      stop(`Zebra${r} Retro Games`),
      stop(`Handwritten${r} Thing`),
    ], {}, '10:00')
    await page.locator('#itl-link-btn').click()
    await expect(page.locator('#itl-link')).toBeVisible()
    const rExact = row(page, exact.shopName), rClose = row(page, `Zebra${r} Retro Games`), rNone = row(page, `Handwritten${r} Thing`)
    await expect(rExact.locator('.itl-link-check')).toBeChecked()
    await expect(rExact.locator('.itl-link-shop')).toHaveValue(exact._id)
    await expect(rExact.locator('.itl-link-kind')).toHaveText('exact')
    await expect(rExact.locator('.itl-link-area')).toHaveText('📍 Akihabara')
    await expect(rClose.locator('.itl-link-check')).not.toBeChecked()
    await expect(rClose.locator('.itl-link-shop')).toHaveValue(close._id)
    await expect(rClose.locator('.itl-link-kind')).toHaveText('close')
    await expect(rNone.locator('.itl-link-check')).not.toBeChecked()
    await expect(rNone.locator('.itl-link-shop')).toHaveValue('')
    // Nothing saved yet.
    expect(saves.length).toBe(0)

    // Pick a shop for the hand-written one: it gets ticked; the close one stays unticked.
    await rNone.locator('.itl-link-shop').selectOption(other._id)
    await expect(rNone.locator('.itl-link-check')).toBeChecked()
    await expect(rNone.locator('.itl-link-area')).toHaveText('📍 Nakano')
    await page.locator('#itl-link-save').click()
    await expect(page.locator('#itl-link-msg')).toHaveText('Linked 2 stops ✓')
    await expect.poll(() => saves.length > 0 ? saves[saves.length - 1].days['2026-12-05'].stops.map((s: any) => s.shopId ?? null) : null, { timeout: 10000 })
      .toEqual([exact._id, null, other._id])
    expect(saves[saves.length - 1].days['2026-12-05'].stops[0]).toMatchObject({ name: exact.shopName, note: 'my own note', dur: 30 }) // its own fields stay
    // The list now only has the close one left; the linked blocks show their area on the first line.
    await expect(page.locator('.itl-link-row .itl-link-name', { hasText: `Zebra${r}` })).toHaveCount(1)
    await expect(block(page, exact.shopName).locator('.itl-first .itl-area')).toHaveText('📍 Akihabara')
    await expect(block(page, other.shopName).locator('.itl-first .itl-area')).toHaveText('📍 Nakano')
    await expect(block(page, `Zebra${r} Retro Games`).locator('.itl-area')).toHaveCount(0)
  })

  test('"🔗 Link to shop" in the edit sheet for one unlinked stop', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 10.2 s alone; much slower under 4 parallel workers
    const { r, close } = await shops(sanity, trackDoc)
    const { saves } = await openTimeline(page, sanity, trackDoc, [stop(`Zebra${r} Retro Games`)], {}, '10:00')
    await block(page, `Zebra${r}`).click()
    const link = page.locator('#itl-ed-link')
    await expect(link).toBeVisible()
    await expect(page.locator('#itl-ed-link-shop')).toHaveValue(close._id) // the suggestion
    await page.locator('#itl-ed-link-save').click()
    await expect(link).toBeHidden() // linked now
    await expect(block(page, close.shopName).locator('.itl-first .itl-area')).toHaveText('📍 Akihabara')
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].stops[0].shopId, { timeout: 10000 }).toBe(close._id)
  })

  test('the area on the first line, right of the time; the name is never hidden; a short block still shows it', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`A Rather Long Shop Name For The First Line ${Date.now()}`), area: 'Akihabara', latitude: 35.7, longitude: 139.77 })
    trackDoc(shop._id)
    await openTimeline(page, sanity, trackDoc, [
      { name: 'x', hours: '10:00 - 21:00', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30, shopId: shop._id },
      { name: 'Next', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 },
    ], {}, '10:00')
    const b = block(page, 'A Rather Long')
    await expect(b.locator('.itl-first')).toHaveText(/^🛍️\[test\] A Rather Long .* · 10:\d\d–10:\d\d · 📍 Akihabara$/)
    const name = (await b.locator('.itl-name').boundingBox())!, box = (await b.boundingBox())!
    expect(name.width).toBeGreaterThan(40) // never squeezed away
    expect(name.y + name.height).toBeLessThanOrEqual(box.y + box.height)
    // A 30-minute block with a "Leave by" line and hours still shows every row it has room for in order.
    await expect(b.locator('.itl-first')).toBeVisible()
  })
})

test.describe('/itinerary on a phone: "🚆 Plan train"', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const icsOf = (href: string) => decodeURIComponent(href.slice('data:text/calendar;charset=utf-8,'.length)).replace(/\r\n /g, '')
  // The real route (walk 5 min): Yamanote, Tokaido Shinkansen Hikari 701, Tokaido Line.
  const LEGS = [
    { line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara', departure: '06:47', platform: '3', toStation: 'Tokyo', arrival: '06:51' },
    { line: 'Tokaido Shinkansen', train: 'Hikari 701', fromStation: 'Tokyo', departure: '07:03', platform: '15', toStation: 'Shizuoka', arrival: '08:02' },
    { line: 'Tokaido Line', train: 'local', fromStation: 'Shizuoka', departure: '08:07', platform: '2', toStation: 'Higashi-Shizuoka', arrival: '08:10' },
  ]
  const SUMMARY = '🚆 06:47 Yamanote → Tokyo · 07:03 Shinkansen Hikari 701 (15) → Shizuoka · 08:07 Tokaido → Higashi-Shizuoka 08:10'
  // A day for it: the hotel near the base, then the shop in Shizuoka.
  const DAY = [
    { name: 'Hotel Breakfast', hours: '', tag: '', slot: '', lat: 35.698, lng: 139.771, dur: 30 },
    { name: 'Shizuoka Hobby Square', hours: '', tag: '', slot: '', lat: 34.9718, lng: 138.3889, dur: 90 },
  ]
  const card = (page: Page, i: number) => page.locator('#itl-tr-legs .itl-tr-leg').nth(i)
  async function fillLeg(page: Page, i: number, l: Record<string, string>) {
    for (const [key, value] of Object.entries(l)) await card(page, i).locator(`.itl-tr-l-${key}`).fill(value)
  }
  const openLeg = async (page: Page) => {
    const band = page.locator('.itl-travel[data-index="1"]')
    await expect(band).toHaveClass(/itl-travel-plan/)
    expect(await band.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('Plan train')
    await band.click()
    await expect(page.locator('#itl-train')).toBeVisible()
  }

  test('the real route entered leg by leg: cards in order, saved as legs, the schedule, the display and the reminder', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 12.9 s alone; much slower under 4 parallel workers
    const { saves } = await openTimeline(page, sanity, trackDoc, DAY, {}, '06:00')
    await openLeg(page)
    await expect(page.locator('#itl-train-maps')).toHaveAttribute('href', /travelmode=transit/)
    await page.locator('#itl-train-manual').click()
    await expect(page.locator('#itl-tr-legs .itl-tr-leg')).toHaveCount(1)
    await page.locator('#itl-tr-walk').fill('5')
    await fillLeg(page, 0, LEGS[0])
    await expect(card(page, 0).locator('.itl-tr-leg-title')).toHaveText('1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51')
    await page.locator('#itl-tr-add-leg').click()
    await expect(card(page, 1).locator('.itl-tr-l-fromStation')).toHaveValue('Tokyo') // starts where the last one arrived
    await fillLeg(page, 1, LEGS[2]) // the wrong one first …
    await page.locator('#itl-tr-add-leg').click()
    await fillLeg(page, 2, LEGS[1])
    await card(page, 2).locator('.itl-tr-up').click() // … and moved into place
    await expect(page.locator('.itl-tr-leg-title')).toHaveText([
      '1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51',
      '2. Tokaido Shinkansen Hikari 701 · Tokyo 07:03 (platform 15) → Shizuoka 08:02',
      '3. Tokaido Line local · Shizuoka 08:07 (platform 2) → Higashi-Shizuoka 08:10',
    ])
    await page.locator('#itl-tr-save').click()
    await expect(page.locator('#itl-travel-editor')).toBeHidden()
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].stops[1].train, { timeout: 10000 }).toEqual({ walkToStationMin: 5, legs: LEGS })

    // The schedule: leave the hotel by 06:47 − 10 − 5; the shop from 08:10 + 5.
    await expect(block(page, 'Shizuoka Hobby Square')).toHaveAttribute('data-start', String(t('08:15')))
    await expect(block(page, 'Shizuoka Hobby Square').locator('.itl-train-line')).toHaveText(SUMMARY)
    await expect(page.locator('.itl-travel[data-index="1"]')).toHaveText('🚆 06:47')
    const ics = icsOf((await block(page, 'Hotel Breakfast').locator('.itn-reminder').getAttribute('href'))!)
    expect(ics).toContain('SUMMARY:Leave Hotel Breakfast 06:32 JST for the 06:47 train → Shizuoka Hobby Square')
    // The sheet: everything in full.
    await block(page, 'Shizuoka Hobby Square').locator('.itl-name').click()
    const lines = await page.locator('#itl-detail-lines li').allTextContents()
    expect(lines).toEqual(expect.arrayContaining([SUMMARY, '🚶 5 min to the first station', '2. Tokaido Shinkansen Hikari 701 · Tokyo 07:03 (platform 15) → Shizuoka 08:02']))
  })

  test('fare, walk from the last station and travel time "from train"; the day\'s train fares', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 9.2 s alone; much slower under 4 parallel workers
    // After Shizuoka, a shop in Yokohama (by train, estimated) whose note gives its fare.
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Yokohama Fare Shop ${Date.now()}`), note: 'JR Tokaido from Shizuoka ¥670', latitude: 35.4658, longitude: 139.6223 })
    trackDoc(shop._id)
    const train = { walkToStationMin: 5, walkFromStationMin: 12, fareYen: 6670, legs: LEGS }
    await openTimeline(page, sanity, trackDoc, [
      DAY[0], { ...DAY[1], train },
      { name: 'x', hours: '', tag: '', slot: '', lat: 35.4658, lng: 139.6223, dur: 60, shopId: shop._id },
    ], { jpyToNokRate: 0.064 }, '06:00')
    // 08:10 at Higashi-Shizuoka + 12 min walk.
    await expect(block(page, 'Shizuoka Hobby Square')).toHaveAttribute('data-start', String(t('08:22')))
    // ¥6,670 + ¥670 from the note; an estimate (a leg by train without a planned train).
    await expect(page.locator('#itl-day-fares')).toHaveText('🚆 Trains today: ¥7,340 per person (≈ 470 kr) · ¥36,700 for 5 · estimate') // the trip has no number: 5

    // The travel time at the top: the train's, not editable.
    await page.locator('.itl-travel[data-index="1"]').click()
    const min = page.locator('#itl-travel-edit .itn-travel-min')
    await expect(min).toHaveValue('100') // 5 + 83 + 12
    await expect(min).toBeDisabled()
    await expect(page.locator('#itl-travel-edit')).toContainText('from train')
    await expect(page.locator('#itl-travel-edit .itn-travel-save')).toHaveCount(0)
    await expect(page.locator('#itl-train-summary')).toHaveText(`${SUMMARY} · 💴 ¥6,670 per person (≈ 427 kr) · ¥6,670 × 5 = ¥33,350`)
    // The editor shows both walks and the fare.
    await page.locator('#itl-train-manual').click()
    await expect(page.locator('#itl-tr-walk-from')).toHaveValue('12')
    await expect(page.locator('#itl-tr-fare')).toHaveValue('6670')
    await page.locator('#itl-tr-cancel').click()
    await page.locator('#itl-travel-editor-close').click()

    // The sheet, in full.
    await block(page, 'Shizuoka Hobby Square').locator('.itl-name').click()
    expect(await page.locator('#itl-detail-lines li').allTextContents()).toEqual(expect.arrayContaining(['🚶 12 min from the last station', '💴 ¥6,670 per person (≈ 427 kr) · ¥6,670 × 5 = ¥33,350']))
    await page.locator('#itl-detail-close').click()

    // Without the train: the estimate again, editable.
    await page.locator('.itl-travel[data-index="1"]').click()
    await page.locator('#itl-train-remove').click()
    await page.locator('.itl-travel[data-index="1"]').click()
    await expect(min).toBeEnabled()
    await expect(min).toHaveValue('')
    await expect(page.locator('#itl-travel-edit')).not.toContainText('from train')
    await expect(page.locator('#itl-day-fares')).toHaveText('🚆 Trains today: ¥670 per person (≈ 43 kr) · ¥3,350 for 5 · estimate')
  })

  test('a train to the airport on the flight day: the flight line\'s train sets when to leave; saved with the day', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, [DAY[0]], { flightHomeDate: '2026-12-05', flightHomeTime: '09:55', flightHomeAirport: 'Haneda' }, '04:30')
    const label = page.locator('.itl-flight-label')
    await expect(label).toHaveText('✈️ Leave for Haneda by 05:55 (Flight 09:55 from Haneda)')
    await label.click()
    await expect(page.locator('#itl-train')).toBeVisible()
    await expect(page.locator('#itl-travel-editor-title')).toHaveText('Hotel Breakfast → Haneda Airport') // from the last stop
    await page.locator('#itl-train-manual').click()
    await page.locator('#itl-tr-walk').fill('5')
    await page.locator('#itl-tr-walk-from').fill('10')
    await fillLeg(page, 0, { line: 'Keikyu Line', train: 'Airport Express', fromStation: 'Shinagawa', departure: '05:30', platform: '2', toStation: 'Haneda Airport Terminal 3', arrival: '05:50' })
    await page.locator('#itl-tr-save').click()
    // Leave by 05:30 − 10 − 5; at the airport 05:50 + 10, before check-in closes at 06:55.
    await expect(label).toHaveText('✈️ Leave for Haneda by 05:15 — 🚆 05:30 train, at the airport 06:00 (Flight 09:55 from Haneda)')
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].airportTrain?.legs?.[0]?.departure, { timeout: 10000 }).toBe('05:30')
    // A later train arrives after check-in closes: flagged.
    await label.click()
    await page.locator('#itl-train-manual').click()
    await fillLeg(page, 0, { departure: '06:40', arrival: '07:00' })
    await page.locator('#itl-tr-save').click()
    await expect(label).toContainText('⚠️ after check-in closes (06:55)')
    await expect(page.locator('.itl-flight')).toHaveClass(/itl-flight-late/)
  })

  test('a train back to the base: the band opens the train panel; the day ends at its arrival + the walk', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, [DAY[1]], {}, '12:00')
    const back = page.locator('.itl-travel-back')
    await back.click()
    await expect(page.locator('#itl-train')).toBeVisible()
    await expect(page.locator('#itl-travel-editor-title')).toHaveText('Shizuoka Hobby Square → Base')
    await page.locator('#itl-train-manual').click()
    await page.locator('#itl-tr-fare').fill('6670')
    await fillLeg(page, 0, { line: 'Tokaido Shinkansen', train: 'Hikari 662', fromStation: 'Shizuoka', departure: '17:10', platform: '1', toStation: 'Tokyo', arrival: '18:10' })
    await page.locator('#itl-tr-save').click()
    await expect(back).toHaveText('🚆 17:10')
    await expect(page.locator('.itl-base-end')).toHaveText('🏠 Back at base ~18:15') // 18:10 + 5
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].returnTrain?.fareYen, { timeout: 10000 }).toBe(6670)
    await expect(page.locator('#itl-day-fares')).toHaveText('🚆 Trains today: ¥6,670 per person · ¥33,350 for 5 · estimate') // the trip there is an estimated train
    // The last stop must be left for it.
    await expect(block(page, 'Shizuoka Hobby Square').locator('.itl-leaveby')).toContainText('Leave by 17:00') // 17:10 − 10 min (no walk to the station given)
    await block(page, 'Shizuoka Hobby Square').locator('.itl-name').click()
    expect(await page.locator('#itl-detail-lines li').allTextContents()).toEqual(expect.arrayContaining([
      '🏠 Back to the base: 🚆 17:10 Shinkansen Hikari 662 (1) → Tokyo 18:10', '💴 ¥6,670 per person · ¥6,670 × 5 = ¥33,350',
    ]))
  })

  test('travelers: the trip\'s number multiplies the fares; a train can say its own', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [DAY[0], { ...DAY[1], train: { walkToStationMin: 5, walkFromStationMin: 12, fareYen: 6670, legs: LEGS } }], { travelers: 4, jpyToNokRate: 0.064 }, '06:00')
    await expect(page.locator('#itl-day-fares')).toContainText('🚆 Trains today: ¥6,670 per person (≈ 427 kr) · ¥26,680 for 4')
    await page.locator('.itl-travel[data-index="1"]').click()
    await expect(page.locator('#itl-train-summary')).toContainText('¥6,670 × 4 = ¥26,680')
    await page.locator('#itl-train-manual').click()
    await expect(page.locator('#itl-tr-travelers')).toHaveAttribute('placeholder', '4')
    await page.locator('#itl-tr-travelers').fill('2')
    await page.locator('#itl-tr-save').click()
    await expect(page.locator('#itl-day-fares')).toContainText('¥13,340 for 2')
  })

  test('the real flight day (6 Dec, 23:00 from Narita): the airport train from the last stop sets its leave-by, Latest and Fix; the day ends at the airport; Check day gets it', async ({ page, sanity, trackDoc }) => {
    const NARITA = { flightHomeDate: '2026-12-06', flightHomeTime: '23:00', flightHomeAirport: 'Narita', flightHomeTerminal: 'T1', firstTokyoDay: '2026-12-06', lastTokyoDay: '2026-12-06' }
    const shop = { name: 'Shinjuku Last Shop', hours: '', tag: '', slot: '', lat: 35.6905, lng: 139.7005, dur: 90, travelMin: 0, travelFrom: '__base__' }
    const { saves } = await openTimeline(page, sanity, trackDoc, [shop], NARITA, '16:00')
    await expect(page.locator('.itl-flight-label')).toHaveText('✈️ Leave for Narita by 18:30 (Flight 23:00 from Narita (T1))')
    // The band after the last stop is the leg to the airport.
    await page.locator('.itl-travel-back').click()
    await expect(page.locator('#itl-travel-editor-title')).toHaveText('Shinjuku Last Shop → Narita Airport')
    await page.locator('#itl-train-manual').click()
    await page.locator('#itl-tr-walk').fill('10')
    await page.locator('#itl-tr-walk-from').fill('5')
    await fillLeg(page, 0, { line: 'Narita Express', train: 'NEX 37', fromStation: 'Shinjuku', departure: '18:15', platform: '5', toStation: 'Narita Airport Terminal 1', arrival: '19:40' })
    await page.locator('#itl-tr-save').click()
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-06'].airportTrain?.legs?.[0]?.train, { timeout: 10000 }).toBe('NEX 37')
    expect(saves[saves.length - 1].days['2026-12-06'].returnTrain).toBeUndefined()
    await expect(page.locator('.itl-travel-back')).toHaveText('🚆 18:15')
    await expect(page.locator('.itl-base-end')).toHaveText('✈️ At Narita Airport ~19:45')
    await expect(page.locator('.itl-flight-label')).toHaveText('✈️ Leave for Narita by 17:55 — 🚆 18:15 train, at the airport 19:45 (Flight 23:00 from Narita (T1))')
    const b = block(page, 'Shinjuku Last Shop')
    await expect(b.locator('.itl-leaveby')).toContainText('Leave by 17:55')
    await b.locator('.itl-name').click()
    await expect(page.locator('#itl-ed-latest')).toHaveText('Latest: 17:55')
    expect(await page.locator('#itl-detail-lines li').allTextContents()).toContain('✈️ To the airport: 🚆 18:15 Narita Express NEX 37 (5) → Narita Airport Terminal 1 19:40')
    // Staying too long: "Fix: leave at 17:55".
    await page.locator('#itl-ed-dur').fill('150')
    await page.locator('#itl-ed-dur').dispatchEvent('change')
    await expect(page.locator('#itl-detail-lines .itl-fix')).toHaveText('Fix: leave at 17:55')
    await page.locator('#itl-detail-close').click()

    // Check day: the request carries the train (the review's deadline follows it).
    let review: any = null
    await page.route('**/api/itinerary-review', async (route) => {
      review = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) })
    })
    await page.locator('#itl-check-btn').click()
    await expect.poll(() => review?.flight?.airportTrain?.legs?.[0]?.departure, { timeout: 10000 }).toBe('18:15')
    expect(review.flight).toMatchObject({ time: '23:00', airport: 'Narita', terminal: 'T1' })
  })

  test('a flight day without stops: the airport train leaves from the base', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, [], { flightHomeDate: '2026-12-06', flightHomeTime: '23:00', flightHomeAirport: 'Narita', firstTokyoDay: '2026-12-06', lastTokyoDay: '2026-12-06' }, '16:00')
    await page.locator('.itl-flight-label').click()
    await expect(page.locator('#itl-travel-editor-title')).toHaveText('Base → Narita Airport')
    await page.locator('#itl-train-manual').click()
    await page.locator('#itl-tr-walk').fill('10')
    await page.locator('#itl-tr-walk-from').fill('5')
    await fillLeg(page, 0, { line: 'Keisei Skyliner', train: 'Skyliner 41', fromStation: 'Keisei Ueno', departure: '18:00', platform: '1', toStation: 'Narita Airport Terminal 1', arrival: '18:41' })
    await page.locator('#itl-tr-save').click()
    await expect(page.locator('.itl-flight-label')).toHaveText('✈️ Leave for Narita by 17:40 — 🚆 18:00 train, at the airport 18:46 (Flight 23:00 from Narita)')
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-06'].airportTrain?.legs?.[0]?.departure, { timeout: 10000 }).toBe('18:00')
  })

  test('the search links carry the time of the leg: depart when the stop before is left, or arrive by a fixed time', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [DAY[0], { ...DAY[1], fixedTime: '09:30', arriveEarly: 30 }], {}, '06:00')
    await page.locator('.itl-travel[data-index="1"]').click()
    await expect(page.locator('#itl-train-when')).toHaveText('🕐 Arriving by 09:00 on 2026-12-05')
    const q = async (sel: string) => Object.fromEntries(new URL((await page.locator(sel).getAttribute('href'))!).searchParams)
    expect(await q('#itl-train-yahoo')).toMatchObject({ y: '2026', m: '12', d: '05', hh: '9', m1: '0', m2: '0', type: '4' })
    expect(await q('#itl-train-maps-time')).toMatchObject({ dirflg: 'r', ttype: 'arr', date: '12/05/26', time: '9:00am' })
    await expect(page.locator('#itl-train-maps')).toHaveAttribute('href', /travelmode=transit/) // today's link stays
    await expect(page.locator('#itl-train-maps-time')).toHaveText('🗺️ Google Maps (with time)')
    // With the real route planned: its stations, and departing when the hotel is left.
    await page.evaluate((legs) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; itl.state[0].stops[1] = { ...itl.state[0].stops[1], fixedTime: null, train: { walkToStationMin: 5, legs } }; itl.render()
    }, LEGS)
    await page.locator('#itl-travel-editor-close').click()
    await page.locator('.itl-travel[data-index="1"]').click()
    await expect(page.locator('#itl-train-when')).toHaveText(/^🕐 Departing \d\d:\d\d on 2026-12-05$/)
    expect(await q('#itl-train-yahoo')).toMatchObject({ from: '秋葉原', to: '東静岡', type: '1' })
  })

    test('arriving much earlier than a fixed time: the hint', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [DAY[0], { ...DAY[1], fixedTime: '09:30', train: { walkToStationMin: 5, legs: LEGS } }], {}, '06:00')
    const b = block(page, 'Shizuoka Hobby Square')
    await b.locator('.itl-name').click()
    expect(await page.locator('#itl-detail-lines li').allTextContents()).toContain('💡 Arrives 08:15, 75 min before 09:30. A later train may be possible.')
  })

  test('times out of order across the legs are refused and nothing is saved', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 7.8 s alone; much slower under 4 parallel workers
    const { saves } = await openTimeline(page, sanity, trackDoc, DAY, {}, '06:00')
    await openLeg(page)
    await page.locator('#itl-train-manual').click()
    await fillLeg(page, 0, LEGS[0])
    await page.locator('#itl-tr-add-leg').click()
    await fillLeg(page, 1, { ...LEGS[1], departure: '06:49' }) // before the first train arrives
    await page.locator('#itl-tr-save').click()
    await expect(page.locator('#itl-tr-error')).toHaveText('The times must be in order: each leg departs before it arrives, and the next leg departs after that.')
    await expect(page.locator('#itl-train-form')).toBeVisible()
    expect(saves.length).toBe(0)
  })

  test('a train saved the old way (with transfers) opens as legs; tapping the train line opens it; Remove takes it off', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, DAY, {}, '06:00')
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook: the first version's shape
      const itl = window.__itl
      itl.state[0].stops[1].train = { line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara', departure: '06:47', platform: '3', toStation: 'Shizuoka', arrival: '08:02', transfers: [{ station: 'Tokyo', line: 'Tokaido Shinkansen', arrival: '06:51', departure: '07:03', platform: '15' }] }
      itl.render()
    })
    await block(page, 'Shizuoka Hobby Square').locator('.itl-train-line').click()
    await expect(page.locator('#itl-train-summary')).toHaveText('🚆 06:47 Yamanote → Tokyo · 07:03 Shinkansen → Shizuoka 08:02')
    await expect(page.locator('#itl-detail')).toBeHidden() // not the stop's sheet
    await page.locator('#itl-train-manual').click()
    await expect(page.locator('.itl-tr-leg-title')).toHaveText([
      '1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51',
      '2. Tokaido Shinkansen · Tokyo 07:03 (platform 15) → Shizuoka 08:02',
    ])
    await page.locator('#itl-tr-cancel').click()
    await page.locator('#itl-train-remove').click()
    await expect(block(page, 'Shizuoka Hobby Square').locator('.itl-train-line')).toHaveCount(0)
    await expect.poll(() => saves.length > 0 && 'train' in saves[saves.length - 1].days['2026-12-05'].stops[1], { timeout: 10000 }).toBe(false)
  })
})

test.describe('/itinerary on a phone: a train from a screenshot', () => {
  const shot = () => ({ name: 'route.png', mimeType: 'image/png', buffer: uniquePng() })
  const READ = {
    walkToStationMin: 5,
    walkFromStationMin: 12,
    fareYen: 6670,
    legs: [
      { line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara', departure: '06:47', platform: '3', toStation: 'Tokyo', arrival: '06:51' },
      { line: 'Tokaido Shinkansen', train: 'Hikari 701', fromStation: 'Tokyo', departure: '07:03', platform: '15', toStation: 'Shizuoka', arrival: '08:02' },
      { line: 'Tokaido Line', train: 'local', fromStation: 'Shizuoka', departure: '08:07', platform: '2', toStation: 'Higashi-Shizuoka', arrival: '08:10' },
    ],
  }
  const DAY = [
    { name: 'Hotel Breakfast', hours: '', tag: '', slot: '', lat: 35.698, lng: 139.771, dur: 30 },
    { name: 'Shizuoka Hobby Square', hours: '', tag: '', slot: '', lat: 34.9718, lng: 138.3889, dur: 90 },
  ]

  test('the legs read fill the cards to check; nothing is saved until Save train; an error is shown and nothing changes', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 8.0 s alone; much slower under 4 parallel workers
    let calls = 0
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, train: READ } }
    await page.route('**/api/train-from-screenshot', async (route) => {
      calls++
      expect(route.request().postDataJSON().image).toMatch(/^[A-Za-z0-9+/=]+$/) // raw base64
      await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
    })
    const { saves } = await openTimeline(page, sanity, trackDoc, DAY, {}, '06:00')
    await page.locator('.itl-travel[data-index="1"]').click()
    await page.locator('#itl-train-shot').setInputFiles(shot())
    await expect(page.locator('#itl-train-shot-msg')).toHaveText('Read from the screenshot — check it, then Save train.')
    await expect(page.locator('#itl-tr-walk')).toHaveValue('5')
    await expect(page.locator('#itl-tr-walk-from')).toHaveValue('12')
    await expect(page.locator('#itl-tr-fare')).toHaveValue('6670')
    await expect(page.locator('.itl-tr-leg-title')).toHaveText([
      '1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51',
      '2. Tokaido Shinkansen Hikari 701 · Tokyo 07:03 (platform 15) → Shizuoka 08:02',
      '3. Tokaido Line local · Shizuoka 08:07 (platform 2) → Higashi-Shizuoka 08:10',
    ])
    expect(calls).toBe(1)
    expect(saves.length).toBe(0) // nothing yet
    // Corrected before saving.
    await page.locator('#itl-tr-legs .itl-tr-leg').nth(1).locator('.itl-tr-l-platform').fill('14')
    await page.locator('#itl-tr-save').click()
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].stops[1].train?.legs?.[1]?.platform, { timeout: 10000 }).toBe('14')
    expect(saves[saves.length - 1].days['2026-12-05'].stops[1].train).toMatchObject({ walkToStationMin: 5, walkFromStationMin: 12, fareYen: 6670 })

    // A reading the endpoint refused (invalid times): the message, and the saved train stays.
    reply = { status: 422, body: { error: 'Train 2: the arrival time must be HH:MM.' } }
    await page.locator('.itl-travel[data-index="1"]').click()
    await page.locator('#itl-train-shot').setInputFiles(shot())
    await expect(page.locator('#itl-train-shot-msg')).toHaveText('⚠️ Train 2: the arrival time must be HH:MM.')
    await expect(page.locator('#itl-train-form')).toBeHidden()
    expect(saves[saves.length - 1].days['2026-12-05'].stops[1].train.legs[0].departure).toBe('06:47')
  })
})

test.describe('/itinerary on a phone: short visits at the default zoom', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  // Every visible part of the block is wholly inside it — nothing cut in half.
  async function expectNothingCut(b: ReturnType<Page['locator']>) {
    const box = (await b.boundingBox())!
    const parts = await b.evaluate((el) => [...el.querySelectorAll('*')].map((c) => {
      const r = c.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, w: r.width, h: r.height }
    }).filter((r) => r.w > 0 && r.h > 0))
    for (const p of parts) {
      expect(p.top).toBeGreaterThanOrEqual(box.y - 0.5)
      expect(p.bottom).toBeLessThanOrEqual(box.y + box.height + 0.5)
    }
  }

  test('a 10-minute and a 20-minute block: one line with name, time, area and icons; everything in full in the sheet', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000) // 9.1 s alone; much slower under 4 parallel workers
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`SQEX CAPSULE GARDEN ${Date.now()}`), area: 'Ikebukuro', openingHours: '10:00 - 19:00', latitude: 35.7, longitude: 139.77 })
    trackDoc(shop._id)
    await openTimeline(page, sanity, trackDoc, [
      { name: 'x', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 10, fixedTime: '18:56', shopId: shop._id }, // the real case
      { name: 'Twenty Min Stop', hours: '10:00 - 19:30', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 20, fixedTime: '19:20' },
      { name: 'After', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, fixedTime: '20:00' },
    ], {}, '18:30')
    await expect(page.locator('.itl-grid')).toHaveAttribute('data-px', '2.25') // the default zoom
    for (const [name, height] of [['SQEX CAPSULE', 30], ['Twenty Min Stop', 45]] as const) {
      const b = block(page, name)
      await expect(b).toHaveCSS('height', `${height}px`)
      await expect(b).toHaveClass(/itl-compact/)
      await expect(b.locator('.itl-first')).toBeVisible()
      await expect(b.locator('.itl-hours')).toHaveCount(0) // whole rows gone, not cut
      await expectNothingCut(b)
    }
    // 10 minutes: one line, the reminder and the warning as icons. 20 minutes: room for the
    // second line ("Arrive" and "Leave by" with its reminder); the warning as ⚠️.
    await expect(block(page, 'SQEX CAPSULE').locator('.itl-times, .itl-badges')).toHaveCount(0)
    await expect(block(page, 'SQEX CAPSULE').locator('.itl-icons .itn-reminder')).toHaveText('⏰')
    await expect(block(page, 'SQEX CAPSULE').locator('.itl-icons .itl-icon')).toHaveText('⚠️')
    await expect(block(page, 'Twenty Min Stop').locator('.itl-times .itl-arrive')).toHaveText('Arrive 19:20')
    await expect(block(page, 'Twenty Min Stop').locator('.itl-times .itl-leaveby')).toBeVisible()
    await expect(block(page, 'Twenty Min Stop').locator('.itl-badges')).toHaveCount(0)
    await expect(block(page, 'Twenty Min Stop').locator('.itl-icons .itl-icon')).toHaveText('⚠️')
    await expect(block(page, 'SQEX CAPSULE').locator('.itl-first')).toContainText('📍 Ikebukuro')
    await expect(block(page, 'SQEX CAPSULE').locator('.itl-icon')).toHaveAttribute('title', /Closes 19:00 \(you leave 19:06\)/)
    // The long block keeps its full layout.
    await expect(block(page, 'After')).not.toHaveClass(/itl-compact/)

    // The sheet has it all.
    await block(page, 'SQEX CAPSULE').locator('.itl-name').click()
    const lines = await page.locator('#itl-detail-lines li').allTextContents()
    expect(lines.some((l) => l.startsWith('Leave by 19:'))).toBe(true)
    expect(lines).toContain('⚠️ Closes 19:00 (you leave 19:06)')
    await expect(page.locator('#itl-detail-lines .itn-reminder')).toHaveText('⏰ Reminder')
  })
})

test.describe('/itinerary on a phone: the time axis, arrive and leave times, arriving early', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })
  const inside = async (outer: ReturnType<Page['locator']>, inner: ReturnType<Page['locator']>) => {
    const o = (await outer.boundingBox())!, i = (await inner.boundingBox())!
    expect(i.x).toBeGreaterThanOrEqual(o.x - 0.5)
    expect(i.x + i.width).toBeLessThanOrEqual(o.x + o.width + 0.5)
    expect(i.y + i.height).toBeLessThanOrEqual(o.y + o.height + 0.5)
  }

  test('a day starting 06:15 with its first stop fixed at 10:00: the axis from 05:00, the start label on it', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Late First Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, fixedTime: '10:00' },
    ], {}, '06:15')
    const grid = page.locator('.itl-grid')
    await expect(grid).toHaveAttribute('data-start', String(t('05:00')))
    const start = page.locator('.itl-base-start')
    await expect(start).toHaveText('🏠 Start: base · 06:15')
    expect((await start.boundingBox())!.y).toBeGreaterThanOrEqual((await grid.boundingBox())!.y)
  })

  test('"Arrive HH:MM" (green) and "Leave by HH:MM" (orange) on the second line, whole, under a very long name', async ({ page, sanity, trackDoc }) => {
    const long = 'A Very Long Shop Name That Takes The Whole First Line And Then Some More Words'
    await openTimeline(page, sanity, trackDoc, [
      { name: long, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, travelMin: 0, travelFrom: '__base__' },
      { name: 'Fixed After', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, fixedTime: '12:00' },
    ], {}, '10:00')
    const b = block(page, 'A Very Long Shop Name')
    const arrive = b.locator('.itl-times .itl-arrive')
    const leave = b.locator('.itl-times .itl-leaveby')
    await expect(arrive).toHaveText('Arrive 10:00')
    await expect(leave).toHaveText(/^Leave by 11:4\d ⏰ Reminder$/) // 12:00 − the walk − 10 min
    await inside(b, arrive)
    await inside(b, leave)
    expect(await arrive.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(46, 204, 113)')
    expect(await leave.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(224, 160, 76)')
    // The second line comes right after the name's line.
    expect(await b.evaluate((el) => [...el.children].map((c) => c.className.split(' ')[0]).slice(0, 2))).toEqual(['itl-first', 'itl-times'])
    // The last stop: only "Arrive".
    await expect(block(page, 'Fixed After').locator('.itl-times')).toHaveText('Arrive 12:00')
  })

  test('arriving early for a fixed time: a shaded zone from the arrival to the fixed time, just above the block, "Arrive 18:30 for 19:00"', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Before Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 60, travelMin: 0, travelFrom: '__base__' },
      { name: 'Early Temple', hours: '', tag: '', slot: '', lat: 35.6526, lng: 139.7279, dur: 90, fixedTime: '19:00', arriveEarly: 30 },
    ], {}, '16:00')
    const zone = page.locator('.itl-early')
    await expect(zone).toHaveCount(1)
    await expect(zone).toHaveText('Arrive 18:30 for 19:00')
    const z = (await zone.boundingBox())!, temple = (await block(page, 'Early Temple').boundingBox())!
    const px = Number(await page.locator('.itl-grid').getAttribute('data-px'))
    expect(Math.abs(z.y + z.height - temple.y)).toBeLessThanOrEqual(1.5) // ends where the block starts
    expect(Math.abs(z.height - 30 * px)).toBeLessThanOrEqual(1.5) // 18:30 → 19:00
    await expect(zone).toHaveAttribute('data-index', '1') // the temple's, not the stop before
  })

  test('the flight day: "✈️ Leave for Haneda by 05:55" inside the axis (a 09:55 flight)', async ({ page, sanity, trackDoc }) => {
    await openTimeline(page, sanity, trackDoc, [
      { name: 'Last Breakfast', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 },
    ], { flightHomeDate: '2026-12-05', flightHomeTime: '09:55', flightHomeAirport: 'Haneda' }, '08:00')
    const line = page.locator('.itl-flight')
    await expect(line).toContainText('✈️ Leave for Haneda by 05:55')
    const grid = page.locator('.itl-grid')
    await expect(grid).toHaveAttribute('data-start', String(t('04:00')))
    expect((await line.boundingBox())!.y).toBeGreaterThanOrEqual((await grid.boundingBox())!.y)
  })

  test('a trip with only its flight dates gets those Tokyo days; the save status is English', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({
      _type: 'tripSettings', label: testName(`Flight Dates Only ${Date.now()}`),
      arrivalDate: '2027-02-21', arrivalTime: '07:55', arrivalAirport: 'Haneda', flightHomeDate: '2027-02-23', flightHomeTime: '09:55', flightHomeAirport: 'Haneda',
    })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-tab')).toHaveText(['21. feb (søn)', '22. feb (man)', '23. feb (tir)'])
    await expect(page.locator('#itl-arrival')).toHaveText('✈️ Landing 07:55 at Haneda Airport')
    await page.locator('#itl-start').fill('10:30')
    await page.locator('#itl-start').dispatchEvent('change')
    await expect(page.locator('#itl-save-status')).toHaveText('Saved ✓', { timeout: 10000 })
  })
})

test.describe('/itinerary on a phone: a base per day ("🏨 Base")', () => {
  const block = (page: Page, name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })

  test('ending the day at a hotel: the header, the trip back there, saved on the day; the next day starts there; the list too', async ({ page, sanity, trackDoc }) => {
    const hotel = await sanity.create({ _type: 'shopNote', shopName: testName(`Hotel Shinjuku ${Date.now()}`), placeType: 'hotel', area: 'Shinjuku', latitude: 35.6905, longitude: 139.7005 })
    trackDoc(hotel._id)
    const { trip, saves } = await openTimeline(page, sanity, trackDoc, [
      { name: 'Shinjuku Shop', hours: '', tag: '', slot: '', lat: 35.6908, lng: 139.7010, dur: 60 },
    ], {}, '10:00')
    await expect(page.locator('.itl-base-end')).toHaveText(/^🏠 Back at base ~/)
    const backBefore = await page.locator('.itl-travel-back').textContent()
    await page.locator('#itl-base-btn').click()
    await expect(page.locator('#itl-base-start option').first()).toHaveText('The trip base')
    await expect(page.locator('#itl-base-end optgroup[label="🏨 Hotels"] option', { hasText: hotel.shopName })).toHaveCount(1)
    await page.locator('#itl-base-end').selectOption(hotel._id)
    await page.locator('#itl-base-save').click()
    await expect(page.locator('#itl-day-hotels')).toHaveText(`🏨 Base → ${hotel.shopName}`)
    await expect(page.locator('.itl-base-end')).toHaveText(new RegExp(`^🏨 Back at \\[test\\] Hotel Shinjuku \\d+ ~`))
    // The trip back is now a short walk to the hotel, not the train to Akihabara.
    await expect(page.locator('.itl-travel-back')).toHaveText(/^🚶/)
    expect(backBefore).toMatch(/^🚆/)
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2026-12-05'].endBase, { timeout: 10000 }).toBe(hotel._id)
    expect(saves[saves.length - 1].days['2026-12-05'].startBase).toBeUndefined()

    // The next day starts at the hotel (and ends there), without a header line.
    await page.locator('.itl-tab', { hasText: '6. des' }).click()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[1].stops = [{ name: 'Next Day Shop', hours: '', tag: '', slot: '', lat: 35.6908, lng: 139.7010, dur: 30 }]
      itl.render()
    })
    await expect(page.locator('.itl-base-start')).toHaveText(`🏨 Start: ${hotel.shopName} · 08:00`)
    await expect(page.locator('#itl-day-hotels')).toBeHidden()
    await page.locator('#itl-base-btn').click()
    await expect(page.locator('#itl-base-start option').first()).toHaveText(`Where the day before ended (${hotel.shopName})`)
    await page.locator('#itl-base-cancel').click()

    // The list: the same bases (its own state — saves are mocked, so it loads the stored plan).
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((id) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops = [{ name: 'Shinjuku Shop', hours: '', tag: '', slot: '', lat: 35.6908, lng: 139.7010, dur: 60 }]; state[0].endBase = id; delete state[0].startBase; render()
    }, hotel._id)
    const first = page.locator('.day-card').first()
    await expect(first.locator('.day-hotels')).toHaveText(`🏨 Base → ${hotel.shopName}`)
    await expect(first.locator('.stop.is-base .stop-name').last()).toHaveText(`Tilbake til ${hotel.shopName}`)
    await expect(page.locator('.day-card').nth(1).locator('.stop.is-base .stop-name').first()).toHaveText(`Start: ${hotel.shopName}`)
  })

  test('a day without bases set keeps the trip base, and saves no base fields', async ({ page, sanity, trackDoc }) => {
    const { saves } = await openTimeline(page, sanity, trackDoc, [
      { name: 'Plain Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 },
    ], {}, '10:00')
    await expect(page.locator('.itl-base-start')).toHaveText('🏠 Start: base · 10:00')
    await expect(page.locator('.itl-base-end')).toHaveText(/^🏠 Back at base ~/)
    await expect(page.locator('#itl-day-hotels')).toBeHidden()
    await page.locator('#itl-start').fill('10:15')
    await page.locator('#itl-start').dispatchEvent('change')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(Object.keys(saves[saves.length - 1].days['2026-12-05'])).toEqual(['startTime', 'stops'])
  })
})
