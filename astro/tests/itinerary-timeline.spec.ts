import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
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

test.describe('/itinerary-timeline: tap an empty spot to add a stop', () => {
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

  test('a shop from the picker: the same grouped list and stop shape as /itinerary\'s add-stop', async ({ page, sanity, trackDoc }) => {
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto('/itinerary')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    const listGroups = await page.locator('.add-form').first().locator('.af-shop optgroup').evaluateAll((els) => els.map((e) => [e.getAttribute('label'), e.children.length]))
    expect(listGroups.length).toBeGreaterThan(0)

    await page.unroute('**/api/itinerary-save')
    const { saves } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY.slice(0, 1))
    const timelineGroups = await page.locator('#itl-add-shop optgroup').evaluateAll((els) => els.map((e) => [e.getAttribute('label'), e.children.length]))
    expect(timelineGroups).toEqual(listGroups)

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

test.describe('/itinerary-timeline: block details and the links', () => {
  test('tapping a block shows its details and "Edit in list" opens /itinerary with that stop in view', async ({ page, sanity, trackDoc }) => {
    const { trip } = await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Square Enix Pop Up Cafe' }) }).click()
    const detail = page.locator('#itl-detail')
    await expect(detail).toBeVisible()
    await expect(page.locator('#itl-add')).toBeHidden() // a block tap isn't an "add here" tap
    await expect(page.locator('#itl-detail-name')).toHaveText('Square Enix Pop Up Cafe Yokohama')
    await expect(page.locator('#itl-detail-lines li').first()).toHaveText('📌 16:30–17:30')
    await expect(page.locator('#itl-detail-lines')).toContainText('You can stay until')
    await expect(page.locator('#itl-detail-edit')).toHaveAttribute('href', `/itinerary?trip=${trip._id}&day=2026-12-05&stop=2`)

    // The list opens with that day's stop highlighted (its own saved plan, so check by position).
    await page.locator('.itl-block').first().click()
    await expect(page.locator('#itl-detail-edit')).toHaveAttribute('href', `/itinerary?trip=${trip._id}&day=2026-12-05&stop=0`)
    await page.locator('#itl-detail-edit').click()
    await expect(page).toHaveURL(`/itinerary?trip=${trip._id}&day=2026-12-05&stop=0`)
    await expect(page.locator('.stop.itn-focus[data-day="0"][data-idx="0"]')).toBeVisible({ timeout: 20000 })
  })

  test('"🗓️ Timeline (beta)" on /itinerary and "← List view" on the timeline, keeping the trip', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Timeline Links ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    const toTimeline = page.locator('#itn-timeline-link')
    await expect(toTimeline).toHaveText('🗓️ Timeline (beta)')
    await toTimeline.click()
    await expect(page).toHaveURL(`/itinerary-timeline?trip=${trip._id}`)
    await expect(page.getByRole('heading', { name: /Timeline/ })).toBeVisible()
    const back = page.locator('#itl-list-link')
    await expect(back).toHaveText('← List view')
    await back.click()
    await expect(page).toHaveURL(`/itinerary?trip=${trip._id}`)
  })
})

// Where an element sits on the screen.
const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!

test.describe('/itinerary-timeline on a phone: readable blocks and zoom', () => {
  test('at the default zoom an hour is 2.5× the old height, and a 30-min block shows its name', async ({ page, sanity, trackDoc }) => {
    expect(PX_PER_MIN * 60).toBe(180) // was 72 px (1.2 px/min)
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
    await openTimeline(page, sanity, trackDoc, YOKOHAMA_DAY)
    const hourGap = async () => {
      const tops = await page.locator('.itl-hour').evaluateAll((els) => els.slice(0, 2).map((e) => (e as HTMLElement).offsetTop))
      return tops[1] - tops[0]
    }
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[2]))
    await page.locator('#itl-zoom-in').click()
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[3]))
    await page.locator('#itl-zoom-out').click()
    await page.locator('#itl-zoom-out').click()
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[1]))

    await page.reload()
    await expect(page.locator('.itl-grid')).toBeVisible()
    expect(await hourGap()).toBe(Math.round(60 * ZOOM_LEVELS[1]))
    await page.locator('#itl-zoom-out').click()
    await expect(page.locator('#itl-zoom-out')).toBeDisabled() // the smallest step
  })
})

test.describe('/itinerary-timeline on a phone: travel chips and overlapping stops', () => {
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

test.describe('/itinerary-timeline on a phone: the end of the day', () => {
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

test.describe('/itinerary-timeline: the day toolbar, map, travel editor, Check day and Suggest route', () => {
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
