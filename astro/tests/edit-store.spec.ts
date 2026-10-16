import { test, expect, testName } from './fixtures'
import { mockShopInfoResult, mockShopInfoEmpty } from './helpers/mock-ai'

test.describe('edit-store: AI "Fill in from web"', () => {
  test('renders a suggestion per field, applies only checked ones, and saves nothing until Save is pressed', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const shopName = testName(`AI Fill Shop ${Date.now()}`)
    const shop = await sanity.create({
      _type: 'shopNote',
      shopName,
      area: 'Akihabara',
      note: 'Take the Denki-gai exit, my own directions here.',
    })
    trackDoc(shop._id)

    await mockShopInfoResult(page, {
      openingHours: '10:00–20:00, closed Tue',
      address: '1-2-3 Example, Chiyoda-ku, Tokyo',
      latitude: 35.6984,
      longitude: 139.7731,
      taxFreeShop: true,
      website: 'https://example-shop.test/en',
      note: 'Known for retro games.',
    })

    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-ai-fill-btn').click()

    const results = page.locator('#s-ai-fill-results')
    await expect(results).toBeVisible()
    const items = results.locator('.es-ai-item')
    await expect(items).toHaveCount(5) // hours, address, coordinates, tax-free, website
    await expect(results).toContainText('Note from search: Known for retro games.')
    // The private note field must never be touched by this feature.
    await expect(page.locator('#s-note')).toHaveValue(shop.note)

    // Uncheck the website suggestion to prove only checked ones get applied.
    const websiteItem = items.filter({ hasText: 'Website' })
    await websiteItem.locator('.es-ai-checkbox').uncheck()

    await results.locator('.es-ai-apply-btn').click()

    await expect(page.locator('#s-hours')).toHaveValue('10:00–20:00, closed Tue')
    await expect(page.locator('#s-address')).toHaveValue('1-2-3 Example, Chiyoda-ku, Tokyo')
    await expect(page.locator('#s-taxfree')).toHaveValue('true')
    await expect(page.locator('#s-website')).toHaveValue('') // left unchecked, not applied

    // Coordinates went through the existing setCoords()/updateMapLink() logic, not a raw
    // field assignment — the formatted #s-coords readout and the map link both update.
    await expect(page.locator('#s-lat')).toHaveValue('35.69840')
    await expect(page.locator('#s-lng')).toHaveValue('139.77310')
    await expect(page.locator('#s-coords')).toContainText('35.69840, 139.77310')
    await expect(page.locator('#s-map-link')).toHaveAttribute('href', 'https://www.google.com/maps?q=35.6984,139.7731')

    // Nothing persisted yet — Apply only touches the live form.
    const beforeSave = await sanity.fetch<{ openingHours: string | null }>('*[_id == $id][0]{ openingHours }', { id: shop._id })
    expect(beforeSave.openingHours ?? null).toBeNull()

    await page.locator('#s-save').click()
    await expect(page).toHaveURL(/\/notes/)

    const afterSave = await sanity.fetch<{
      openingHours: string
      address: string
      latitude: number
      longitude: number
      taxFreeShop: boolean
      website: string | null
      note: string
    }>('*[_id == $id][0]{ openingHours, address, latitude, longitude, taxFreeShop, website, note }', { id: shop._id })
    expect(afterSave.openingHours).toBe('10:00–20:00, closed Tue')
    expect(afterSave.address).toBe('1-2-3 Example, Chiyoda-ku, Tokyo')
    expect(afterSave.latitude).toBeCloseTo(35.6984, 4)
    expect(afterSave.longitude).toBeCloseTo(139.7731, 4)
    expect(afterSave.taxFreeShop).toBe(true)
    expect(afterSave.website ?? null).toBeNull() // unchecked suggestion never applied/saved
    expect(afterSave.note).toBe(shop.note) // untouched
  })

  test('checks a field by default only when its current value is empty', async ({ page, trackDoc, sanity }) => {
    const shopName = testName(`AI Fill Prefilled Shop ${Date.now()}`)
    const shop = await sanity.create({
      _type: 'shopNote',
      shopName,
      area: 'Shibuya',
      address: 'Already known address',
      openingHours: '09:00–18:00',
    })
    trackDoc(shop._id)

    await mockShopInfoResult(page, {
      openingHours: '10:00–20:00, closed Tue',
      address: 'Suggested different address',
      latitude: 35.658,
      longitude: 139.7016,
      taxFreeShop: false,
      website: 'https://example-shop.test/en',
    })

    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-ai-fill-btn').click()

    const results = page.locator('#s-ai-fill-results')
    await expect(results).toBeVisible()
    const items = results.locator('.es-ai-item')

    await expect(items.filter({ hasText: 'Opening hours' }).locator('.es-ai-checkbox')).not.toBeChecked()
    await expect(items.filter({ hasText: 'Address' }).locator('.es-ai-checkbox')).not.toBeChecked()
    await expect(items.filter({ hasText: 'Coordinates' }).locator('.es-ai-checkbox')).toBeChecked()
    await expect(items.filter({ hasText: 'Tax-free shop' }).locator('.es-ai-checkbox')).toBeChecked()
    await expect(items.filter({ hasText: 'Website' }).locator('.es-ai-checkbox')).toBeChecked()
  })

  test('does not offer a suggestion for a field the endpoint could not confirm', async ({ page, trackDoc, sanity }) => {
    const shopName = testName(`AI Fill Partial Shop ${Date.now()}`)
    const shop = await sanity.create({ _type: 'shopNote', shopName, area: 'Nakano' })
    trackDoc(shop._id)

    // openingHours/latitude/longitude are null — as if the server-side validation in
    // shop-info.ts dropped an unparseable hours string or out-of-range coordinates.
    await mockShopInfoResult(page, {
      openingHours: null,
      latitude: null,
      longitude: null,
      address: 'Found address',
      taxFreeShop: true,
      website: 'https://example-shop.test/en',
    })

    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-ai-fill-btn').click()

    const results = page.locator('#s-ai-fill-results')
    await expect(results).toBeVisible()
    const items = results.locator('.es-ai-item')
    await expect(items).toHaveCount(3) // address, tax-free, website only
    await expect(items.filter({ hasText: 'Opening hours' })).toHaveCount(0)
    await expect(items.filter({ hasText: 'Coordinates' })).toHaveCount(0)
  })

  test('shows sources as links', async ({ page, trackDoc, sanity }) => {
    const shopName = testName(`AI Fill Sources Shop ${Date.now()}`)
    const shop = await sanity.create({ _type: 'shopNote', shopName, area: 'Ikebukuro' })
    trackDoc(shop._id)

    await mockShopInfoResult(
      page,
      { address: 'Found address' },
      [{ title: 'Example Shop — Official Site', url: 'https://example-shop.test/en' }]
    )

    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-ai-fill-btn').click()

    const sourcesLine = page.locator('#s-ai-fill-results .es-ai-sources')
    await expect(sourcesLine).toBeVisible()
    const link = sourcesLine.locator('a', { hasText: 'Example Shop — Official Site' })
    await expect(link).toHaveAttribute('href', 'https://example-shop.test/en')
  })

  test('shows a message and no card when nothing reliable was found', async ({ page, trackDoc, sanity }) => {
    const shopName = testName(`AI Fill Empty Shop ${Date.now()}`)
    const shop = await sanity.create({ _type: 'shopNote', shopName, area: 'Yokohama' })
    trackDoc(shop._id)

    await mockShopInfoEmpty(page)

    await page.goto(`/edit-store?id=${shop._id}`)
    await page.locator('#s-ai-fill-btn').click()

    await expect(page.locator('#s-ai-fill-results')).toBeHidden()
    await expect(page.locator('#s-ai-fill-msg')).toContainText('Nothing reliable found for this shop.')
  })
})
