import { test, expect, testName } from './fixtures'
import { mockShopInfoResult } from './helpers/mock-ai'

test.describe('add-store: AI "Fill in from web"', () => {
  test('renders suggestions for a not-yet-saved shop and applies only checked fields', async ({ page, trackDoc, sanity }) => {
    const shopName = testName(`New Shop AI Fill ${Date.now()}`)

    await mockShopInfoResult(page, {
      openingHours: '11:00–21:00',
      address: '4-5-6 Example, Toshima-ku, Tokyo',
      latitude: 35.7295,
      longitude: 139.7109,
      taxFreeShop: true,
      website: 'https://example-shop.test/en',
    })

    await page.goto('/add-store')
    await page.locator('#s-name').fill(shopName)
    await page.locator('#s-area').selectOption('Ikebukuro')
    await page.locator('#s-ai-fill-btn').click()

    const results = page.locator('#s-ai-fill-results')
    await expect(results).toBeVisible()
    const items = results.locator('.as-ai-item')
    await expect(items).toHaveCount(5)

    // Uncheck opening hours to prove only checked suggestions apply.
    await items.filter({ hasText: 'Opening hours' }).locator('.as-ai-checkbox').uncheck()
    await results.locator('.as-ai-apply-btn').click()

    await expect(page.locator('#s-hours')).toHaveValue('')
    await expect(page.locator('#s-address')).toHaveValue('4-5-6 Example, Toshima-ku, Tokyo')
    await expect(page.locator('#s-lat')).toHaveValue('35.72950')
    await expect(page.locator('#s-lng')).toHaveValue('139.71090')
    await expect(page.locator('#s-map-link')).toHaveAttribute('href', 'https://www.google.com/maps?q=35.7295,139.7109')
    await expect(page.locator('#s-taxfree')).toHaveValue('true')
    await expect(page.locator('#s-website')).toHaveValue('https://example-shop.test/en')

    await page.locator('#s-save').click()
    await expect(page.locator('#s-msg')).toContainText('Saved')

    const id = await sanity.fetch<string | null>('*[_type == "shopNote" && shopName == $name][0]._id', { name: shopName })
    expect(id).toBeTruthy()
    trackDoc(id)
    const doc = await sanity.fetch<{ openingHours: string | null; address: string; website: string }>(
      '*[_id == $id][0]{ openingHours, address, website }',
      { id }
    )
    expect(doc.openingHours ?? null).toBeNull() // unchecked suggestion never applied/saved
    expect(doc.address).toBe('4-5-6 Example, Toshima-ku, Tokyo')
    expect(doc.website).toBe('https://example-shop.test/en')
  })
})
