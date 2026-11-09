import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import type { PlaceResult } from '../src/lib/place-search'
import { findLocationQuery } from '../src/lib/place-search-ui'

// "📍 Find location" (lib/place-search-ui.ts findLocation) and Shop Notes' "Missing location".
// /api/place-search is answered here: OpenStreetMap is never called.
const MATCHES: PlaceResult[] = [
  { name: 'Super Potato', address: '1-11-2 Sotokanda, Chiyoda, Tokyo', lat: 35.6995, lng: 139.7712, kind: 'games shop', placeType: 'shop', area: 'Akihabara', openingHours: null, osmId: 'node1' },
  { name: 'Super Potato Annex', address: 'Sotokanda, Chiyoda, Tokyo', lat: 35.7001, lng: 139.7705, kind: 'shop', placeType: 'shop', area: 'Akihabara', openingHours: null, osmId: 'node2' },
  { name: 'Potato Cafe', address: 'Ueno, Taito, Tokyo', lat: 35.71, lng: 139.77, kind: 'cafe', placeType: 'restaurant', area: 'Ueno', openingHours: null, osmId: 'node3' },
  { name: 'Fourth', address: 'Tokyo', lat: 35.6, lng: 139.7, kind: 'shop', placeType: 'shop', area: null, openingHours: null, osmId: 'node4' },
]
async function mockSearch(page: Page) {
  const queries: string[] = []
  await page.route('**/api/place-search?*', async (route) => {
    queries.push(new URL(route.request().url()).searchParams.get('q') || '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results: MATCHES, attribution: '© OpenStreetMap contributors' }) })
  })
  return queries
}

test('the search: the name and the area', () => {
  expect(findLocationQuery('Super Potato', 'Akihabara')).toBe('Super Potato Akihabara')
  expect(findLocationQuery(' Super Potato ', '')).toBe('Super Potato')
  expect(findLocationQuery('Super Potato', null)).toBe('Super Potato')
})

test.describe('api/shop-coords: the address with the coordinates', () => {
  test('saved when the shop has none, never over one it has', async ({ request, sanity, trackDoc }) => {
    const empty = await sanity.create({ _type: 'shopNote', shopName: testName(`No Address ${Date.now()}`) })
    trackDoc(empty._id)
    const has = await sanity.create({ _type: 'shopNote', shopName: testName(`Has Address ${Date.now()}`), address: 'Our own address' })
    trackDoc(has._id)
    for (const id of [empty._id, has._id]) {
      const res = await request.post('/api/shop-coords', { data: { id, latitude: 35.6995, longitude: 139.7712, address: '1-11-2 Sotokanda' } })
      expect(res.status()).toBe(200)
    }
    const docs = await sanity.fetch<any[]>('*[_id in $ids]{ _id, address, latitude }', { ids: [empty._id, has._id] })
    const byId = Object.fromEntries(docs.map((d) => [d._id, d]))
    expect(byId[empty._id]).toMatchObject({ address: '1-11-2 Sotokanda', latitude: 35.6995 })
    expect(byId[has._id]).toMatchObject({ address: 'Our own address', latitude: 35.6995 })
  })
})

test.describe('the shop page: "📍 Find location"', () => {
  test('only without coordinates; the top 3 matches for name + area; the chosen one saved, with its address', async ({ page, sanity, trackDoc }) => {
    const name = testName(`Super Potato ${Date.now()}`)
    const shop = await sanity.create({ _type: 'shopNote', shopName: name, area: 'Akihabara' })
    trackDoc(shop._id)
    const placed = await sanity.create({ _type: 'shopNote', shopName: testName(`Placed ${Date.now()}`), latitude: 35.7, longitude: 139.77 })
    trackDoc(placed._id)
    const queries = await mockSearch(page)

    await page.goto(`/edit-store?id=${placed._id}`)
    await expect(page.getByRole('heading', { name: 'Edit shop' })).toBeVisible()
    await expect(page.locator('#s-find')).toBeHidden()

    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-find').click()
    const results = page.locator('#s-find-results .ps-result')
    await expect(results).toHaveCount(3)
    expect(queries).toEqual([`${name} Akihabara`])
    await expect(page.locator('#s-find-results .ps-attr')).toHaveText('Search: © OpenStreetMap contributors')
    await results.nth(1).click()
    await expect(page.locator('#s-locate-msg')).toHaveText('📍 Location saved: Super Potato Annex (and its address).')
    await expect(page.locator('#s-find')).toBeHidden()
    await expect(page.locator('#s-lat')).toHaveValue('35.70010')
    await expect(page.locator('#s-address')).toHaveValue('Sotokanda, Chiyoda, Tokyo')
    const doc = await sanity.fetch<any>('*[_id == $id][0]{ latitude, longitude, address }', { id: shop._id })
    expect(doc).toEqual({ latitude: 35.7001, longitude: 139.7705, address: 'Sotokanda, Chiyoda, Tokyo' })
  })
})

test.describe('the timeline sheet: "📍 Find location"', () => {
  test('a stop without coordinates: confirm a match, and the stop has them', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Find Location Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    const queries = await mockSearch(page)
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[0].startTime = '10:00'
      itl.state[0].stops = [
        { name: 'Placed Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 },
        { name: 'Lost Stop', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 30 },
      ]
      itl.render()
    })
    const block = (n: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: n }) })
    await block('Placed Stop').click()
    await expect(page.locator('#itl-detail')).toBeVisible()
    await expect(page.locator('#itl-ed-find')).toBeHidden()
    await page.locator('#itl-detail-close').click()

    await block('Lost Stop').click()
    await page.locator('#itl-ed-find').click()
    const results = page.locator('#itl-ed-find-results .ps-result')
    await expect(results).toHaveCount(3)
    expect(queries).toEqual(['Lost Stop'])
    await results.first().click()
    await expect(page.locator('#itl-ed-coord-msg')).toHaveText('Lagret ✓ (ikke koblet til en butikk)')
    await expect.poll(() => saves.some((s) => s.days?.['2026-12-05']?.stops[1]?.lat === 35.6995)).toBe(true)
    await expect(page.locator('#itl-ed-find')).toBeHidden()
  })
})

test.describe('Shop Notes: "📍 Missing location"', () => {
  test('a count of places without coordinates; the toggle shows only those', async ({ page, sanity, trackDoc }) => {
    const tag = `MissLoc${Date.now()}`
    const a = await sanity.create({ _type: 'shopNote', shopName: testName(`${tag} Placed`), latitude: 35.7, longitude: 139.77 })
    trackDoc(a._id)
    const b = await sanity.create({ _type: 'shopNote', shopName: testName(`${tag} Lost`) })
    trackDoc(b._id)
    await page.goto('/notes')
    await page.locator('#search-input').fill(tag.toLowerCase())
    await expect(page.locator('#notes-count')).toHaveText('2 places')
    await expect(page.locator('#missing-count')).toHaveText('1')
    await page.locator('#missing-filter').click()
    await expect(page.locator('#missing-filter')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#notes-count')).toHaveText('1 place')
    await expect(page.locator('.note-card:visible .note-name')).toHaveText([testName(`${tag} Lost`)])
    await page.locator('#missing-filter').click()
    await expect(page.locator('#notes-count')).toHaveText('2 places')
  })
})
