import { test, expect, testName } from './fixtures'
import { hoursOnDate } from '../src/lib/opening-hours'
import { shopOptionGroups, withHoursOnDate, searchResultNote } from '../src/lib/itinerary-plan'
import { planDocIdFor } from '../src/lib/trip-plans'

// The itinerary's place pickers show each place's hours on the day being planned
// (opening-hours.ts hoursOnDate, itinerary-plan.ts withHoursOnDate / searchResultNote):
// "Animate · 10:00–21:00", "✓ Darumanome · 2. des · 11:00–23:00", "… · Closed", "… · 24h".
// 2027-03-01 is a Monday, 2027-03-02 a Tuesday, 2027-03-06 a Saturday.
const MON = '2027-03-01', TUE = '2027-03-02', SAT = '2027-03-06'
const WEEKLY = 'Mon–Fri 10:00–20:00, Sat–Sun 11:00–19:00'
const CLOSED_TUE = '10:00–21:00, closed Tue'
const ALL_DAY = 'Open 24 hours'
const MARKET = 'Market 2 / 3 mar 09:00 - 14:30'
const GARBLED = 'ask at the counter'

test.describe('hours on a date (lib/opening-hours.ts hoursOnDate)', () => {
  test('weekday-specific, closed that day, 24 hours, date-specific, several ranges, missing and not understood', () => {
    expect(hoursOnDate(WEEKLY, MON)).toBe('10:00–20:00')
    expect(hoursOnDate(WEEKLY, SAT)).toBe('11:00–19:00')
    expect(hoursOnDate(CLOSED_TUE, MON)).toBe('10:00–21:00')
    expect(hoursOnDate(CLOSED_TUE, TUE)).toBe('Closed')
    expect(hoursOnDate(ALL_DAY, TUE)).toBe('24h')
    expect(hoursOnDate('24時間営業', TUE)).toBe('24h')
    expect(hoursOnDate(MARKET, TUE)).toBe('09:00–14:30')
    expect(hoursOnDate(MARKET, MON)).toBe('Closed') // open on given dates only
    expect(hoursOnDate('11:30-14:00, 17:00-22:00', MON)).toBe('11:30–14:00, 17:00–22:00')
    expect(hoursOnDate('18:00-02:00', MON)).toBe('18:00–02:00')
    expect(hoursOnDate(null, MON)).toBeNull()
    expect(hoursOnDate('', MON)).toBeNull()
    expect(hoursOnDate(GARBLED, MON)).toBeNull()
    expect(hoursOnDate('Sat 10:00–18:00', MON)).toBeNull() // says nothing about Monday
    expect(hoursOnDate(WEEKLY, null)).toBeNull()
    expect(hoursOnDate(WEEKLY, 'not a date')).toBeNull()
  })

  test('the labels: appended after the name (and the ✓ days); nothing when unknown; same groups and order', () => {
    expect(withHoursOnDate('Animate', WEEKLY, MON)).toBe('Animate · 10:00–20:00')
    expect(withHoursOnDate('✓ Darumanome Akihabara · 2. des', '11:00–23:00', '2026-12-02')).toBe('✓ Darumanome Akihabara · 2. des · 11:00–23:00')
    expect(withHoursOnDate('Animate', null, MON)).toBe('Animate')
    expect(withHoursOnDate('Animate', WEEKLY, null)).toBe('Animate')
    const shops = [
      { _id: 'W', shopName: 'Weekly Shop', area: 'Akihabara', openingHours: WEEKLY },
      { _id: 'C', shopName: 'Closed Tuesdays', area: 'Akihabara', openingHours: CLOSED_TUE },
      { _id: 'A', shopName: 'All Day', area: 'Nakano', openingHours: ALL_DAY },
      { _id: 'N', shopName: 'No Hours', area: 'Akihabara' },
    ]
    const labels = (date: string | null) => shopOptionGroups(shops, null, { W: [MON] }, date).map((g) => [g.area, g.items.map((i) => i.name)])
    expect(labels(TUE)).toEqual([
      ['Akihabara', ['Closed Tuesdays · Closed', 'No Hours', '✓ Weekly Shop · 1. mar · 10:00–20:00']],
      ['Nakano', ['All Day · 24h']],
    ])
    // Without a day (the list page, the day's base): as before.
    expect(labels(null)).toEqual([
      ['Akihabara', ['Closed Tuesdays', 'No Hours', '✓ Weekly Shop · 1. mar']],
      ['Nakano', ['All Day']],
    ])
    // A search result: the saved place's hours first, else OpenStreetMap's.
    const planShops = shops.map((s) => ({ ...s, latitude: 35.7, longitude: 139.77 }))
    expect(searchResultNote({ name: 'Weekly Shop', lat: 35.7, lng: 139.77, openingHours: ALL_DAY }, planShops, { W: [MON] }, SAT)).toBe('✓ Weekly Shop · 1. mar · 11:00–19:00')
    expect(searchResultNote({ name: 'Elsewhere', lat: 35.7, lng: 139.77, openingHours: ALL_DAY }, planShops, {}, SAT)).toBe('24h')
    expect(searchResultNote({ name: 'Elsewhere', lat: 35.7, lng: 139.77, openingHours: null }, planShops, {}, SAT)).toBe('')
  })
})

test.describe('/itinerary: hours in the place pickers', () => {
  test('add stop, link to shop and search show the day\'s hours, and follow a switch of day', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(120_000)
    const tag = Date.now()
    const area = `Hours Area ${tag}`
    const shop = async (name: string, openingHours?: string) => {
      const d = await sanity.create({ _type: 'shopNote', shopName: testName(`${name} ${tag}`), area, latitude: 35.7, longitude: 139.77, ...(openingHours ? { openingHours } : {}) })
      trackDoc(d._id)
      return d
    }
    const allDay = await shop('All Day', ALL_DAY)
    const closedTue = await shop('Closed Tue', CLOSED_TUE)
    const garbled = await shop('Garbled', GARBLED)
    const market = await shop('Market', MARKET)
    const noHours = await shop('No Hours')
    const weekly = await shop('Weekly', WEEKLY)
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Hours Trip ${tag}`), firstTokyoDay: MON, lastTokyoDay: SAT })
    trackDoc(trip._id)
    const data = JSON.stringify({ v: 2, days: { [TUE]: { startTime: '10:00', stops: [{ name: 'x', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, shopId: weekly._id }] } } })
    const plan = await sanity.createOrReplace({ _id: planDocIdFor({ ...trip }), _type: 'itineraryState', data, updatedAt: new Date().toISOString(), trip: { _type: 'reference', _ref: trip._id, _weak: true } })
    trackDoc(plan._id)
    await page.route('**/api/itinerary-save', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))

    await page.goto(`/itinerary?trip=${trip._id}`)
    await page.locator('.itl-tab', { hasText: '1. mar' }).click()
    const grid = page.locator('.itl-grid')
    await expect(grid).toBeVisible()
    const openAdd = async (hour: number) => {
      const start = Number(await grid.getAttribute('data-start'))
      await grid.click({ position: { x: 3, y: Math.round((hour * 60 - start) * Number(await grid.getAttribute('data-px'))) + 2 } })
      await expect(page.locator('#itl-add')).toBeVisible()
    }
    const group = (sel: string) => page.locator(`${sel} optgroup[label="${area}"] option`)
    const n = (s: any) => s.shopName as string

    // Monday: the grouping and A–Z order stay; ✓ days, then the hours.
    await openAdd(11)
    await expect(group('#itl-add-shop')).toHaveText([
      `${n(allDay)} · 24h`, `${n(closedTue)} · 10:00–21:00`, n(garbled), `${n(market)} · Closed`, n(noHours), `✓ ${n(weekly)} · 2. mar · 10:00–20:00`,
    ])
    // The choice survives a switch of day, and the labels become Tuesday's.
    await page.locator('#itl-add-shop').selectOption({ label: `${n(closedTue)} · 10:00–21:00` })
    await page.locator('.itl-tab', { hasText: '2. mar' }).click()
    await expect(group('#itl-add-shop')).toHaveText([
      `${n(allDay)} · 24h`, `${n(closedTue)} · Closed`, n(garbled), `${n(market)} · 09:00–14:30`, n(noHours), `✓ ${n(weekly)} · 2. mar · 10:00–20:00`,
    ])
    await expect(page.locator('#itl-add-shop option:checked')).toHaveText(`${n(closedTue)} · Closed`)

    // "🔍 Search place": the saved place's hours, OpenStreetMap's for an unknown place; a switch of
    // day updates them.
    await page.route('**/api/place-search?*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, attribution: '', results: [
      { name: n(weekly), address: 'Akihabara', lat: 35.7, lng: 139.77, kind: 'shop', placeType: 'shop', area: null, openingHours: null, osmId: 'n1' },
      { name: 'Unknown Market Place', address: 'Akihabara', lat: 35.71, lng: 139.78, kind: 'shop', placeType: 'shop', area: null, openingHours: CLOSED_TUE, osmId: 'n2' },
      { name: 'Unknown Quiet Place', address: 'Akihabara', lat: 35.72, lng: 139.79, kind: 'shop', placeType: 'shop', area: null, openingHours: null, osmId: 'n3' },
    ] }) }))
    await page.locator('#itl-add-search-btn').click()
    await page.locator('#itl-add-search-q').fill('anything')
    await page.locator('#itl-add-search-q').press('Enter')
    const results = page.locator('#itl-add-search-results .ps-result')
    await expect(results).toHaveCount(3)
    await expect(results.nth(0).locator('.ps-note')).toHaveText(`✓ ${n(weekly)} · 2. mar · 10:00–20:00`)
    await expect(results.nth(1).locator('.ps-note')).toHaveText('Closed')
    await expect(results.nth(2).locator('.ps-note')).toHaveCount(0)
    await page.locator('.itl-tab', { hasText: '6. mar' }).click()
    await expect(results.nth(0).locator('.ps-note')).toHaveText(`✓ ${n(weekly)} · 2. mar · 11:00–19:00`)
    await expect(results.nth(1).locator('.ps-note')).toHaveText('10:00–21:00')
    await page.locator('#itl-add-cancel').click()

    // "🔗 Link to shop" on a hand-written stop (Saturday): Saturday's hours.
    await page.evaluate((day) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; const d = itl.state.find((x: any) => x.day === day)
      d.stops.push({ name: 'Hand Written Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 }); itl.render()
    }, SAT)
    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Hand Written Stop' }) }).locator('.itl-name').click()
    await expect(page.locator('#itl-ed-link')).toBeVisible()
    await expect(group('#itl-ed-link-shop')).toHaveText([
      `${n(allDay)} · 24h`, `${n(closedTue)} · 10:00–21:00`, n(garbled), `${n(market)} · Closed`, n(noHours), `✓ ${n(weekly)} · 2. mar · 11:00–19:00`,
    ])
    await page.locator('#itl-detail-close').click()

    // "🔗 Link stops to shops": each row's picker has its own stop's day — the Saturday stop's
    // hours even when Tuesday is the day on screen.
    await page.locator('.itl-tab', { hasText: '2. mar' }).click()
    await page.locator('#itl-link-btn').click()
    const row = page.locator('.itl-link-row').filter({ has: page.locator('.itl-link-name', { hasText: 'Hand Written Stop' }) })
    await expect(row.locator(`.itl-link-shop optgroup[label="${area}"] option`)).toHaveText([
      `${n(allDay)} · 24h`, `${n(closedTue)} · 10:00–21:00`, n(garbled), `${n(market)} · Closed`, n(noHours), `✓ ${n(weekly)} · 2. mar · 11:00–19:00`,
    ])
  })
})
