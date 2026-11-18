import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { isGoogleMapsUrl, isShortMapsLink, parseGoogleMapsUrl, resolveMapsLink } from '../src/lib/google-maps-link'
import { simplifyPlaceQuery, searchWithRetry, type PlaceResult } from '../src/lib/place-search'

// Finding places that OpenStreetMap doesn't find by their full name: a pasted Google Maps link
// (lib/google-maps-link.ts — no Google API, no Google page read), a simplified retry, and
// "✨ Search with AI" (/api/shop-info, mocked here).
const PLACE_URL = 'https://www.google.com/maps/place/SURUGA-YA+Main+Store/@35.6996,139.7703,17z/data=!3m1!4b1!4m6!3m5!1s0x60188ea7:0x1!8m2!3d35.6998771!4d139.7711234!16s%2Fg%2F1t'

test.describe('Google Maps links (lib/google-maps-link.ts)', () => {
  test('the common formats: the pin, q=/query=/ll=, the map centre, /search/<lat,lng>; the name from /place/ or q=', () => {
    // The place's pin (!3d/!4d) wins over the map centre; the name from /maps/place/.
    expect(parseGoogleMapsUrl(PLACE_URL)).toEqual({ name: 'SURUGA-YA Main Store', lat: 35.6998771, lng: 139.7711234 })
    expect(parseGoogleMapsUrl('https://maps.google.com/?q=35.6812,139.7671')).toEqual({ name: '', lat: 35.6812, lng: 139.7671 })
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=35.71%2C139.77')).toEqual({ name: '', lat: 35.71, lng: 139.77 })
    expect(parseGoogleMapsUrl('https://www.google.com/maps?q=Animate+Akihabara&ll=35.70,139.77')).toEqual({ name: 'Animate Akihabara', lat: 35.7, lng: 139.77 })
    expect(parseGoogleMapsUrl('https://www.google.co.jp/maps/@35.7001,139.7702,15z')).toEqual({ name: '', lat: 35.7001, lng: 139.7702 })
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/35.6990,+139.7710')).toEqual({ name: '', lat: 35.699, lng: 139.771 })
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/%E9%A7%BF%E6%B2%B3%E5%B1%8B/@35.7,139.77,17z')).toMatchObject({ name: '駿河屋', lat: 35.7 })
    // Without coordinates (a short link not followed yet, a text search): nothing.
    expect(parseGoogleMapsUrl('https://www.google.com/maps/search/SURUGA-YA')).toBeNull()
    // What counts as a Google Maps link.
    expect(isGoogleMapsUrl(PLACE_URL)).toBe(true)
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/AbC123xyz')).toBe(true)
    expect(isShortMapsLink('https://maps.app.goo.gl/AbC123xyz')).toBe(true)
    expect(isShortMapsLink('https://goo.gl/maps/AbC123')).toBe(true)
    expect(isGoogleMapsUrl('https://example.com/maps/place/x/@35.7,139.77,17z')).toBe(false)
    expect(isGoogleMapsUrl('https://www.google.com/search?q=suruga-ya')).toBe(false)
    expect(isGoogleMapsUrl('SURUGA-YA Main Store')).toBe(false)
  })

  test('a share link: only its redirect is followed (the Location header, never a page), to Google hosts only', async () => {
    const calls: { url: string; redirect?: string }[] = []
    const fake = (routes: Record<string, { status: number; location?: string }>) => (async (url: string, init: any) => {
      calls.push({ url, redirect: init?.redirect })
      const r = routes[url]
      return new Response(null, { status: r?.status ?? 404, headers: r?.location ? { location: r.location } : {} })
    }) as any
    expect(await resolveMapsLink('https://maps.app.goo.gl/AbC123xyz', fake({ 'https://maps.app.goo.gl/AbC123xyz': { status: 302, location: PLACE_URL } }))).toBe(PLACE_URL)
    expect(calls.every((c) => c.redirect === 'manual')).toBe(true)
    // Through a consent page: its continue= URL.
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(PLACE_URL)}&gl=NO`
    expect(await resolveMapsLink('https://maps.app.goo.gl/Consent1', fake({ 'https://maps.app.goo.gl/Consent1': { status: 302, location: consent } }))).toBe(PLACE_URL)
    // Somewhere that isn't Google: refused.
    expect(await resolveMapsLink('https://maps.app.goo.gl/Evil', fake({ 'https://maps.app.goo.gl/Evil': { status: 302, location: 'https://evil.example/maps/place/x/@35.7,139.77,17z' } }))).toBeNull()
    // Not a redirect (a page): refused.
    expect(await resolveMapsLink('https://maps.app.goo.gl/Page', fake({ 'https://maps.app.goo.gl/Page': { status: 200 } }))).toBeNull()
    // Only share links are fetched at all.
    calls.length = 0
    expect(await resolveMapsLink('https://example.com/whatever', fake({}))).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test('the endpoint reads a full link without fetching anything; a non-Maps URL is refused', async ({ request }) => {
    const res = await request.get(`/api/maps-link?url=${encodeURIComponent(PLACE_URL)}`)
    expect(res.status()).toBe(200)
    expect((await res.json()).result).toMatchObject({ name: 'SURUGA-YA Main Store', lat: 35.6998771, lng: 139.7711234, kind: 'Google Maps link' })
    expect((await request.get(`/api/maps-link?url=${encodeURIComponent('https://example.com/x')}`)).status()).toBe(400)
  })
})

test.describe('the simplified retry (lib/place-search.ts)', () => {
  test('store words, floors and repeats left out, the area added; retried once only when the full search finds nothing', async () => {
    expect(simplifyPlaceQuery('SURUGA-YA Main Store SURUGA-YA Bldg', 'Akihabara')).toBe('SURUGA-YA Akihabara')
    expect(simplifyPlaceQuery('Yodobashi Camera Multimedia Akiba 4F', null)).toBe('Yodobashi Camera Multimedia Akiba')
    expect(simplifyPlaceQuery('Mandarake Complex Building, Floor 3', 'Akihabara')).toBe('Mandarake Complex Akihabara')
    expect(simplifyPlaceQuery('Animate', null)).toBeNull() // nothing to simplify
    expect(simplifyPlaceQuery('Super Potato Akihabara', 'Akihabara')).toBeNull()
    const hit = { name: 'SURUGA-YA', lat: 35.7, lng: 139.77 } as PlaceResult
    const asked: string[] = []
    const search = async (q: string) => { asked.push(q); return q === 'SURUGA-YA Akihabara' ? [hit] : [] }
    expect(await searchWithRetry('SURUGA-YA Main Store SURUGA-YA Bldg', 'Akihabara', search)).toEqual({ results: [hit], simplified: 'SURUGA-YA Akihabara' })
    expect(asked).toEqual(['SURUGA-YA Main Store SURUGA-YA Bldg', 'SURUGA-YA Akihabara'])
    asked.length = 0
    expect(await searchWithRetry('SURUGA-YA Akihabara', null, search)).toEqual({ results: [hit], simplified: null })
    expect(asked).toEqual(['SURUGA-YA Akihabara']) // found first time: no retry
  })
})

// The pages: /api/place-search and /api/shop-info answered here (never OpenStreetMap or the AI).
async function mockSearch(page: Page, results: unknown[], simplified: string | null = null) {
  const asked: { q: string; area: string | null }[] = []
  await page.route('**/api/place-search?*', async (route) => {
    const u = new URL(route.request().url())
    asked.push({ q: u.searchParams.get('q') || '', area: u.searchParams.get('area') })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results, simplified, attribution: '© OpenStreetMap contributors' }) })
  })
  return asked
}
const SURUGA = { name: 'SURUGA-YA', address: 'Sotokanda, Chiyoda, Tokyo', lat: 35.6999, lng: 139.7712, kind: 'shop', placeType: 'shop', area: 'Akihabara', openingHours: null, osmId: 'n9' }

test.describe('"Add place": a Google Maps link, the simplified retry and the AI search', () => {
  test('a pasted Google Maps link is a result to confirm; choosing it fills the name and coordinates', async ({ page }) => {
    const asked = await mockSearch(page, [])
    await page.goto('/add-store')
    await page.locator('#s-search').fill(PLACE_URL)
    const result = page.locator('#s-search-results .ps-result')
    await expect(result).toHaveCount(1)
    await expect(result.locator('.ps-name')).toHaveText('SURUGA-YA Main Store')
    await expect(result.locator('.ps-kind')).toHaveText('Google Maps link')
    await expect(page.locator('#s-search-results .ps-msg').first()).toHaveText('From the Google Maps link — check it before choosing:')
    expect(asked).toHaveLength(0) // not sent to the place search
    await result.click()
    await expect(page.locator('#s-name')).toHaveValue('SURUGA-YA Main Store')
    await expect(page.locator('#s-lat')).toHaveValue('35.69988')
    await expect(page.locator('#s-lng')).toHaveValue('139.77112')
  })

  test('nothing for the full name: the results of the simplified search, said so; the area sent with it', async ({ page }) => {
    const asked = await mockSearch(page, [SURUGA], 'SURUGA-YA Akihabara')
    await page.goto('/add-store')
    await page.locator('#s-area').selectOption('Akihabara')
    await page.locator('#s-search').fill('SURUGA-YA Main Store SURUGA-YA Bldg')
    await expect(page.locator('#s-search-results .ps-result')).toHaveCount(1)
    await expect(page.locator('#s-search-results .ps-msg').first()).toHaveText('No matches for “SURUGA-YA Main Store SURUGA-YA Bldg” — results for “SURUGA-YA Akihabara”:')
    expect(asked[0]).toEqual({ q: 'SURUGA-YA Main Store SURUGA-YA Bldg', area: 'Akihabara' })
  })

  test('still nothing: "✨ Search with AI" only on tap; its place shown to confirm', async ({ page }) => {
    await mockSearch(page, [])
    const aiCalls: any[] = []
    await page.route('**/api/shop-info', async (route) => {
      aiCalls.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: { address: '4-2-1 Sotokanda, Chiyoda, Tokyo', latitude: 35.69988, longitude: 139.77112, openingHours: 'Daily 10:00–21:00' }, sources: [] }) })
    })
    await page.goto('/add-store')
    await page.locator('#s-area').selectOption('Akihabara')
    await page.locator('#s-search').fill('SURUGA-YA Main Store SURUGA-YA Bldg')
    const ai = page.locator('#s-search-results .ps-ai')
    await expect(ai).toHaveText('✨ Search with AI')
    expect(aiCalls).toHaveLength(0) // not until tapped
    await ai.click()
    const result = page.locator('#s-search-results .ps-result')
    await expect(result).toHaveCount(1)
    await expect(result.locator('.ps-kind')).toHaveText('found with AI web search')
    await expect(page.locator('#s-search-results .ps-msg').first()).toHaveText('✨ Found with an AI web search — check it before choosing:')
    expect(aiCalls).toEqual([{ shopName: 'SURUGA-YA Main Store SURUGA-YA Bldg', area: 'Akihabara' }])
    await result.click()
    await expect(page.locator('#s-address')).toHaveValue('4-2-1 Sotokanda, Chiyoda, Tokyo')
    await expect(page.locator('#s-lat')).toHaveValue('35.69988')
  })

  test('the AI search finding no location says so', async ({ page }) => {
    await mockSearch(page, [])
    await page.route('**/api/shop-info', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: { address: null, latitude: null, longitude: null }, sources: [] }) }))
    await page.goto('/add-store')
    await page.locator('#s-search').fill('Nowhere Shop Zzz')
    await page.locator('#s-search-results .ps-ai').click()
    await expect(page.locator('#s-search-results')).toContainText('✨ The AI search found no location for “Nowhere Shop Zzz”.')
  })
})

test.describe('"📍 Find location" on the shop page: a pasted Google Maps link', () => {
  test('nothing found by name: paste a link, confirm it, and the location is saved', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`SURUGA-YA Main Store ${Date.now()}`), area: 'Akihabara' })
    trackDoc(shop._id)
    await mockSearch(page, [])
    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-find').click()
    await expect(page.locator('#s-find-results .ps-ai')).toBeVisible() // the AI search is offered too
    await page.locator('#s-find-results .ps-link').fill(PLACE_URL)
    await page.locator('#s-find-results .ps-link-use').click()
    const result = page.locator('#s-find-results .ps-result')
    await expect(result.locator('.ps-name')).toHaveText('SURUGA-YA Main Store')
    await result.click()
    await expect(page.locator('#s-locate-msg')).toContainText('📍 Location saved: SURUGA-YA Main Store')
    const doc = await sanity.fetch<any>('*[_id == $id][0]{ latitude, longitude }', { id: shop._id })
    expect(doc).toEqual({ latitude: 35.6998771, longitude: 139.7711234 })
  })
})

test.describe('the place\'s own pin, never the view centre; "Open in Maps"', () => {
  test('a place URL: the pin after the place\'s id, not the @ view centre (SQUARE ENIX Cafe & Shop SHINJUKU); embed links; a stray %', async () => {
    const { placePin } = await import('../src/lib/google-maps-link')
    // The shape of the Shinjuku case (reconstructed — the view centre is where the place was saved,
    // 35.6897996, 139.6994265; the pin in the place's data block is the place). An earlier !3d!4d
    // pair (before the place's id) isn't the place either.
    const url = 'https://www.google.com/maps/place/SQUARE+ENIX+Cafe+%26+Shop+SHINJUKU/@35.6897996,139.6994265,17z/data=!3m1!4b1!4m10!1m3!3d35.6800001!4d139.6900001!3m5!1s0x60188cd0f3a8b1d5:0x9e1d1c7c1c6c3a1b!8m2!3d35.6913721!4d139.7036412!16s%2Fg%2F11y3k1q1x9?entry=ttu'
    expect(parseGoogleMapsUrl(url)).toEqual({ name: 'SQUARE ENIX Cafe & Shop SHINJUKU', lat: 35.6913721, lng: 139.7036412 })
    // Only a view centre: that, as the last resort.
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/Somewhere/@35.6897996,139.6994265,17z')).toMatchObject({ lat: 35.6897996, lng: 139.6994265 })
    // An embed ("pb=") link: !2d<lng>!3d<lat>.
    expect(placePin('/maps/embed?pb=!1m18!1m12!1m3!1d3240!2d139.7036412!3d35.6913721!2m3!1f0')).toEqual({ lat: 35.6913721, lng: 139.7036412 })
    // A stray "%" doesn't break it.
    expect(parseGoogleMapsUrl('https://www.google.com/maps/place/100%+Shop/@35.70,139.77,17z/data=!8m2!3d35.701!4d139.771')).toMatchObject({ lat: 35.701, lng: 139.771 })
  })

  test('"Open in Maps": by name and address when there is one, else the coordinates', async () => {
    const { openInMapsUrl } = await import('../src/lib/shop-maps')
    const S = 'https://www.google.com/maps/search/?api=1&query='
    expect(openInMapsUrl({ name: 'SQUARE ENIX Cafe & Shop SHINJUKU', address: '3-36-1 Shinjuku, Shinjuku-ku, Tokyo', lat: 35.6897996, lng: 139.6994265 }))
      .toBe(S + encodeURIComponent('SQUARE ENIX Cafe & Shop SHINJUKU, 3-36-1 Shinjuku, Shinjuku-ku, Tokyo'))
    expect(openInMapsUrl({ name: 'Animate', lat: 35.7, lng: 139.77 })).toBe(S + encodeURIComponent('35.7,139.77'))
    expect(openInMapsUrl({ name: 'ARTNIA', address: 'https://www.google.com/maps/place/ARTNIA/data=!4m2' })).toBe('https://www.google.com/maps/place/ARTNIA/data=!4m2')
    expect(openInMapsUrl({ name: 'Animate', area: 'Akihabara' })).toBe(S + encodeURIComponent('Animate, Akihabara, Japan'))
  })
})

// The real link (from Kim), SQUARE ENIX Cafe & Shop SHINJUKU: the map's view centre @35.6897996,
// 139.6994265 — what got saved — and the place's pin !3d35.6897953!4d139.7020068 (~235 m east).
const SHINJUKU_URL = 'https://www.google.com/maps/place/SQUARE+ENIX+Cafe+%26+Shop+SHINJUKU/@35.6897996,139.6994265,17z/data=!4m14!1m7!3m6!1s0x60188deef92f695d:0x279997bf7829c69e!2sSQUARE+ENIX+Cafe+%26+Shop+SHINJUKU!8m2!3d35.6897953!4d139.7020068!16s%2Fg%2F11nk80rh09!3m5!1s0x60188deef92f695d:0x279997bf7829c69e!8m2!3d35.6897953!4d139.7020068!16s%2Fg%2F11nk80rh09?entry=ttu&g_ep=EgoyMDI2MTExNS4wIKXMDSoASAFQAw%3D%3D'

test.describe('the real SQUARE ENIX Cafe & Shop SHINJUKU link', () => {
  test('the parser gives the place\'s pin, not the view centre that was saved; so does a link pasted as coordinates', async () => {
    expect(parseGoogleMapsUrl(SHINJUKU_URL)).toEqual({ name: 'SQUARE ENIX Cafe & Shop SHINJUKU', lat: 35.6897953, lng: 139.7020068 })
    const { parseLatLng } = await import('../src/lib/itinerary-plan')
    // The coordinate field took the link's first number pair — the view centre. Now: the pin.
    expect(parseLatLng(SHINJUKU_URL)).toEqual({ lat: 35.6897953, lng: 139.7020068 })
    expect(parseLatLng(SHINJUKU_URL)).not.toEqual({ lat: 35.6897996, lng: 139.6994265 })
    expect(parseLatLng('35.6990, 139.7710')).toEqual({ lat: 35.699, lng: 139.771 }) // plain coordinates as before
    expect(parseLatLng('https://maps.app.goo.gl/AbC123')).toBeNull() // a share link has none in it
  })

  test('the shop page\'s "Paste lat, lng" box: the link gives the pin', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`SQUARE ENIX Cafe & Shop SHINJUKU ${Date.now()}`), area: 'Shinjuku' })
    trackDoc(shop._id)
    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-coord-paste').fill(SHINJUKU_URL)
    await page.locator('#s-coord-apply').click()
    await expect(page.locator('#s-lat')).toHaveValue('35.68980')
    await expect(page.locator('#s-lng')).toHaveValue('139.70201') // the pin; the view centre would be 139.69943
  })
})
