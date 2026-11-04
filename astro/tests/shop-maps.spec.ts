import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { googleMapsPlaceUrl } from '../src/lib/shop-maps'

test.describe('"📷 Photos on Google Maps" (lib/shop-maps.ts)', () => {
  test('coordinates and name, coordinates only, the address, a Maps link as the address, or name and area', () => {
    expect(googleMapsPlaceUrl({ name: 'Super Potato', lat: 35.699358, lng: 139.770702, address: 'ignored' }))
      .toBe('https://www.google.com/maps/search/Super%20Potato/@35.699358,139.770702,17z')
    expect(googleMapsPlaceUrl({ lat: 35.7, lng: 139.77 }))
      .toBe('https://www.google.com/maps/search/?api=1&query=35.7%2C139.77')
    expect(googleMapsPlaceUrl({ name: 'Mandarake', address: '3-11-12 Sotokanda, Chiyoda-ku' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Mandarake%2C%203-11-12%20Sotokanda%2C%20Chiyoda-ku')
    expect(googleMapsPlaceUrl({ name: 'X', address: 'https://maps.app.goo.gl/abc123' })).toBe('https://maps.app.goo.gl/abc123')
    expect(googleMapsPlaceUrl({ name: 'Animate', area: 'Ikebukuro' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Animate%2C%20Ikebukuro%2C%20Japan')
    // Not coordinates: falls back to the address.
    expect(googleMapsPlaceUrl({ name: 'Y', lat: 200, lng: 139, address: 'Tokyo' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Y%2C%20Tokyo')
    // Something else pasted as the address is searched for, never used as the link.
    expect(googleMapsPlaceUrl({ name: 'Z', address: 'javascript:alert(1)' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Z%2C%20javascript%3Aalert(1)')
  })
})

test.describe('"📷 Photos on Google Maps" on the pages', () => {
  const expectNewTab = async (link: ReturnType<Page['locator']>) => {
    await expect(link).toHaveText('📷 Photos on Google Maps')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener')
  }

  test('on the shop\'s edit page: from its coordinates and name, or its address without coordinates', async ({ page, sanity, trackDoc }) => {
    const withCoords = await sanity.create({ _type: 'shopNote', shopName: testName(`Maps Shop ${Date.now()}`), latitude: 35.7011, longitude: 139.7712 })
    const withAddress = await sanity.create({ _type: 'shopNote', shopName: testName(`Maps Address Shop ${Date.now()}`), address: '1-2-3 Sotokanda, Tokyo' })
    trackDoc(withCoords._id); trackDoc(withAddress._id)

    await page.goto(`/edit-store?id=${withCoords._id}`)
    const link = page.locator('#s-gmaps-photos')
    await expectNewTab(link)
    await expect(link).toHaveAttribute('href', `https://www.google.com/maps/search/${encodeURIComponent(withCoords.shopName)}/@35.7011,139.7712,17z`)

    await page.goto(`/edit-store?id=${withAddress._id}`)
    await expect(link).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${withAddress.shopName}, 1-2-3 Sotokanda, Tokyo`)}`)
  })

  test('in the timeline\'s edit sheet: the linked shop, or the stop\'s own name and coordinates', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Sheet Maps Shop ${Date.now()}`), address: 'Nakano Broadway 3F' })
    trackDoc(shop._id)
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Maps Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate((shopId) => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[0].stops = [
        { name: 'Linked', hours: '', tag: '', slot: '', lat: null, lng: null, dur: 60, shopId, travelMin: 0, travelFrom: '__base__' },
        { name: 'Own Coords Stop', hours: '', tag: '', slot: '', lat: 35.69, lng: 139.7, dur: 60 },
      ]
      itl.render()
    }, shop._id)
    const block = (name: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: name }) })

    await block(shop.shopName).click()
    const link = page.locator('#itl-ed-gmaps')
    await expectNewTab(link)
    await expect(link).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.shopName}, Nakano Broadway 3F`)}`)
    await page.locator('#itl-detail-close').click()

    await block('Own Coords Stop').click()
    await expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/Own%20Coords%20Stop/@35.69,139.7,17z')
  })
})
