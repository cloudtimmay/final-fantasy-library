import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { findIdByField } from './helpers/sanity-test-client'
import { parseNominatim, osmHoursToText, nominatimUrl, searchPlaces, resetPlaceSearchForTests, PLACE_SEARCH_USER_AGENT } from '../src/lib/place-search'
import { stopHoursText } from '../src/lib/itinerary-plan'

// Place search with OpenStreetMap Nominatim (lib/place-search.ts). Nominatim is never called: the
// unit tests pass a fake fetch with saved responses; the pages get /api/place-search mocked.
const SAMPLE = [
  { osm_type: 'way', osm_id: 1, lat: '35.7147', lon: '139.7739', category: 'leisure', type: 'park', name: '上野恩賜公園', namedetails: { name: '上野恩賜公園', 'name:en': 'Ueno Park' },
    display_name: 'Ueno Park, Ueno, Taito, Tokyo, Japan', address: { park: 'Ueno Park', neighbourhood: 'Ueno Koen', suburb: 'Ueno', city_district: 'Taito' }, extratags: { opening_hours: 'Mo-Su 05:00-23:00' } },
  { osm_type: 'node', osm_id: 2, lat: '35.6995', lon: '139.7712', category: 'shop', type: 'games', name: 'Super Potato', display_name: 'Super Potato, Sotokanda, Chiyoda, Tokyo, Japan',
    address: { suburb: 'Akihabara' }, extratags: { opening_hours: 'Mo-Fr 11:00-20:00; Sa,Su 10:00-20:00' } },
  { osm_type: 'node', osm_id: 3, lat: '35.7138', lon: '139.7773', category: 'railway', type: 'station', name: 'Ueno', display_name: 'Ueno, Taito, Tokyo, Japan', address: { suburb: 'Ueno' }, extratags: {} },
  { osm_type: 'node', osm_id: 4, lat: '35.7128', lon: '139.7774', category: 'tourism', type: 'hotel', name: 'Hotel Ueno', display_name: 'Hotel Ueno, Taito, Tokyo, Japan', address: {}, extratags: { opening_hours: '24/7' } },
  { osm_type: 'relation', osm_id: 5, lat: '35.7022', lon: '139.7741', category: 'place', type: 'neighbourhood', name: 'Akihabara', display_name: 'Akihabara, Chiyoda, Tokyo, Japan', address: { city_district: 'Chiyoda' } },
  { osm_type: 'node', osm_id: 6, lat: 'nope', lon: '1', category: 'shop', type: 'yes', name: 'Broken' },
]

test.describe('place search (lib/place-search.ts)', () => {
  test('results: the English name, address, coordinates, kind, our place type, the area, hours our parser understands', () => {
    const r = parseNominatim(SAMPLE)
    expect(r.map((p) => [p.name, p.kind, p.placeType, p.area, p.openingHours])).toEqual([
      ['Ueno Park', 'park', 'sight', 'Ueno Koen', '05:00–23:00'],
      ['Super Potato', 'games shop', 'shop', 'Akihabara', null], // weekday-split OSM hours: not converted
      ['Ueno', 'station', 'other', 'Ueno', null],
      ['Hotel Ueno', 'hotel', 'hotel', null, 'Open 24 hours'],
      ['Akihabara', 'neighbourhood', 'area', 'Chiyoda', null],
    ])
    expect(r[0]).toMatchObject({ lat: 35.7147, lng: 139.7739, address: 'Ueno Park, Ueno, Taito, Tokyo, Japan', osmId: 'way1' })
    expect(osmHoursToText('10:00-20:00')).toBe('10:00–20:00')
    expect(osmHoursToText('Mo-Sa 10:00-20:00')).toBeNull()
  })

  test('the request: Japan, English, details; an identifying User-Agent; cached; at most one a second', async () => {
    resetPlaceSearchForTests()
    const url = new URL(nominatimUrl('Ueno Park'))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ q: 'Ueno Park', format: 'jsonv2', countrycodes: 'jp', 'accept-language': 'en', addressdetails: '1', extratags: '1' })
    let clock = 1_000_000
    const sleeps: number[] = []
    const calls: { url: string; ua: string }[] = []
    const deps = {
      now: () => clock,
      sleep: async (ms: number) => { sleeps.push(ms); clock += ms },
      fetch: (async (u: string, init: any) => { calls.push({ url: u, ua: init.headers['User-Agent'] }); clock += 50; return new Response(JSON.stringify(SAMPLE.slice(0, 1)), { status: 200 }) }) as any,
    }
    const first = await searchPlaces('Ueno Park', deps)
    expect(first[0].name).toBe('Ueno Park')
    expect(calls[0].ua).toBe(PLACE_SEARCH_USER_AGENT)
    // The same search again (any case): from the cache.
    await searchPlaces('  ueno park ', deps)
    expect(calls).toHaveLength(1)
    // Another one right after: waits for the second to pass.
    await searchPlaces('Akihabara', deps)
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([950])
    // Too short: no request.
    expect(await searchPlaces('a', deps)).toEqual([])
    expect(calls).toHaveLength(2)
  })

  test('an "📍 Area" stop has no opening hours: never closed', () => {
    const shops = new Map<string, any>([['a', { _id: 'a', shopName: 'Ueno area', placeType: 'area', openingHours: '10:00-20:00' }]])
    expect(stopHoursText({ name: 'x', shopId: 'a', hours: '10:00-11:00' } as any, shops)).toEqual({ text: '', fromShop: true })
  })
})

// The pages: /api/place-search answered here.
async function mockSearch(page: Page, results: unknown[]) {
  const queries: string[] = []
  await page.route('**/api/place-search?*', async (route) => {
    queries.push(new URL(route.request().url()).searchParams.get('q') || '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results, attribution: '© OpenStreetMap contributors' }) })
  })
  return queries
}

test.describe('"Add place": search to fill it in', () => {
  test('typing "Ueno Park" lists matches; choosing one fills name, address, coordinates, type, area and hours', async ({ page }) => {
    const queries = await mockSearch(page, parseNominatim(SAMPLE))
    await page.goto('/add-store')
    await expect(page.getByRole('heading', { name: 'Add place' })).toBeVisible()
    await page.locator('#s-search').fill('Ueno Park')
    const results = page.locator('#s-search-results .ps-result')
    await expect(results).toHaveCount(5)
    await expect(page.locator('#s-search-results .ps-attr')).toHaveText('Search: © OpenStreetMap contributors')
    expect(queries).toEqual(['Ueno Park']) // once, after the pause in typing
    await results.first().click()
    await expect(page.locator('#s-name')).toHaveValue('Ueno Park')
    await expect(page.locator('#s-address')).toHaveValue('Ueno Park, Ueno, Taito, Tokyo, Japan')
    await expect(page.locator('#s-lat')).toHaveValue('35.71470')
    await expect(page.locator('#s-lng')).toHaveValue('139.77390')
    await expect(page.locator('#s-type')).toHaveValue('sight')
    await expect(page.locator('#s-hours')).toHaveValue('05:00–23:00')
    await expect(page.locator('#s-area')).toHaveValue('__new__')
    await expect(page.locator('#s-area-new')).toHaveValue('Ueno Koen')
    await expect(page.locator('#s-search-msg')).toContainText('Filled in from OpenStreetMap: Ueno Park (park)')
    await expect(page.locator('#s-save')).toHaveText('Save place')
    // "✨ Fill in from web" stays.
    await expect(page.locator('#s-ai-fill-btn')).toBeVisible()
  })
})

test.describe('/itinerary: "🔍 Search place" in the add-stop form', () => {
  async function open(page: Page, sanity: any, trackDoc: (id: string) => void) {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Search Place Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; itl.state[0].startTime = '10:00'; itl.state[0].stops = []; itl.render()
    })
    const grid = page.locator('.itl-grid')
    const start = Number(await grid.getAttribute('data-start'))
    await grid.click({ position: { x: 3, y: Math.round((11 * 60 - start) * Number(await grid.getAttribute('data-px'))) + 2 } })
    await expect(page.locator('#itl-add')).toBeVisible()
  }
  const stops = (page: Page) => page.evaluate(() => (window as any).__itl.state[0].stops)

  test('a place saved in Shop Notes and added, linked to it', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const name = testName(`Ueno Park ${Date.now()}`)
    await mockSearch(page, [{ ...parseNominatim(SAMPLE)[0], name }])
    await open(page, sanity, trackDoc)
    await page.locator('#itl-add-search-btn').click()
    await page.locator('#itl-add-search-q').fill('Ueno Park')
    await page.locator('#itl-add-search-results .ps-result').first().click()
    await expect(page.locator('#itl-add-chosen')).toHaveText(`📍 ${name} (park)`)
    await expect(page.locator('#itl-add-saveplace')).toBeChecked()
    await page.locator('#itl-add-save').click()
    await expect(page.locator('#itl-add')).toBeHidden()
    const id = await findIdByField('shopNote', 'shopName', name)
    trackDoc(id)
    expect(id).toBeTruthy()
    const doc = await sanity.getDocument(id!)
    expect(doc).toMatchObject({ placeType: 'sight', latitude: 35.7147, longitude: 139.7739, openingHours: '05:00–23:00', area: 'Ueno Koen' })
    expect((await stops(page))[0]).toMatchObject({ shopId: id, name })
  })

  test('only as a stop (not saved): its name, coordinates and hours', async ({ page, sanity, trackDoc }) => {
    await mockSearch(page, parseNominatim(SAMPLE))
    await open(page, sanity, trackDoc)
    await page.locator('#itl-add-search-btn').click()
    await page.locator('#itl-add-search-q').fill('Hotel Ueno')
    await page.locator('#itl-add-search-results .ps-result').nth(3).click()
    await page.locator('#itl-add-saveplace').uncheck()
    await page.locator('#itl-add-save').click()
    const s = (await stops(page))[0]
    expect(s).toMatchObject({ name: 'Hotel Ueno', lat: 35.7128, lng: 139.7774, hours: 'Open 24 hours' })
    expect(s.shopId ?? null).toBeNull()
  })
})
