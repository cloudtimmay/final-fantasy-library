import path from 'node:path'
import { test, expect } from './fixtures'
import { mockIdentifyCustomResult } from './helpers/mock-ai'
import { validateIdentifyResult, currencyForIdentifiedPrice } from '../src/lib/identify-result'

const ALBUM_PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')

// identify-product.ts can't be imported here (it uses `import.meta.env` — see
// find-prices-prompt.spec.ts), so its validation is tested through lib/identify-result.ts,
// which is exactly the function the endpoint returns the result of.
test.describe('identify result: currency validation', () => {
  test('keeps JPY or NOK read off the tag, drops anything else', () => {
    expect(validateIdentifyResult({ price: 1000, currency: 'JPY' }).currency).toBe('JPY')
    expect(validateIdentifyResult({ price: 399, currency: 'NOK' }).currency).toBe('NOK')
    expect(validateIdentifyResult({ price: 10, currency: 'USD' }).currency).toBeUndefined()
    expect(validateIdentifyResult({ price: 10, currency: null }).currency).toBeUndefined()
  })

  test('taxIncluded is dropped for a NOK price, kept for JPY or an unknown currency', () => {
    expect(validateIdentifyResult({ price: 399, currency: 'NOK', taxIncluded: true }).taxIncluded).toBeUndefined()
    expect(validateIdentifyResult({ price: 3300, currency: 'JPY', taxIncluded: false }).taxIncluded).toBe(false)
    expect(validateIdentifyResult({ price: 3300, taxIncluded: true }).taxIncluded).toBe(true)
  })

  test('currency choice: tag currency first, then the selected source', () => {
    expect(currencyForIdentifiedPrice('NOK', 'japanStore', 'JPY')).toBe('NOK')
    expect(currencyForIdentifiedPrice('JPY', 'norway', 'NOK')).toBe('JPY')
    expect(currencyForIdentifiedPrice(undefined, 'japanStore', 'USD')).toBe('JPY')
    expect(currencyForIdentifiedPrice(undefined, 'norway', 'JPY')).toBe('NOK')
    expect(currencyForIdentifiedPrice(undefined, 'online', 'USD')).toBe('USD')
    expect(currencyForIdentifiedPrice('USD', 'online', 'EUR')).toBe('EUR')
  })
})

async function identifyAndUse(page: import('@playwright/test').Page) {
  await page.locator('#p-photo-gallery').setInputFiles(ALBUM_PHOTO)
  await page.locator('#p-identify-btn').click()
  await expect(page.locator('#p-identify-card')).toBeVisible()
  await page.locator('#p-identify-card .idf-identify-use-btn').click()
}

test.describe('add-price: identify sets the currency', () => {
  test('a kr tag sets NOK even with "Shop in Japan" selected, and hides the tax checkbox', async ({ page }) => {
    await mockIdentifyCustomResult(page, { productName: 'Beast Ball', category: 'figure', price: 2499, currency: 'NOK' })
    await page.goto('/add-price')
    await page.locator('#p-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#p-identify-btn').click()
    await expect(page.locator('#p-identify-card')).toContainText('2,499 kr')
    await page.locator('#p-identify-card .idf-identify-use-btn').click()

    await expect(page.locator('#p-price')).toHaveValue('2499')
    await expect(page.locator('#p-currency')).toHaveValue('NOK')
    await expect(page.locator('#p-tax')).toBeHidden()
  })

  test('a ¥ tag sets JPY and applies taxIncluded', async ({ page }) => {
    await mockIdentifyCustomResult(page, { productName: 'Test Album', category: 'album', price: 3300, currency: 'JPY', taxIncluded: false })
    await page.goto('/add-price')
    await page.locator('input[name="p-source"][value="online"]').check()
    await page.locator('#p-currency').selectOption('USD')
    await identifyAndUse(page)

    await expect(page.locator('#p-currency')).toHaveValue('JPY')
    await expect(page.locator('#p-tax')).not.toBeChecked()
  })

  test('no currency on the tag + Norway source sets NOK', async ({ page }) => {
    await mockIdentifyCustomResult(page, { productName: 'Test Figure', category: 'figure', price: 399 })
    await page.goto('/add-price')
    await page.locator('input[name="p-source"][value="norway"]').check()
    await page.locator('#p-currency').selectOption('JPY')
    await identifyAndUse(page)

    await expect(page.locator('#p-currency')).toHaveValue('NOK')
  })

  test('no currency on the tag + Online source leaves the selected currency unchanged', async ({ page }) => {
    await mockIdentifyCustomResult(page, { productName: 'Test Album', category: 'album', price: 42.99 })
    await page.goto('/add-price')
    await page.locator('input[name="p-source"][value="online"]').check()
    await page.locator('#p-currency').selectOption('USD')
    await identifyAndUse(page)

    await expect(page.locator('#p-price')).toHaveValue('42.99')
    await expect(page.locator('#p-currency')).toHaveValue('USD')
  })

  test('no currency on the tag + Shop in Japan sets JPY', async ({ page }) => {
    await mockIdentifyCustomResult(page, { productName: 'Test Game', category: 'game', price: 5980, taxIncluded: true })
    await page.goto('/add-price')
    await page.locator('#p-currency').selectOption('NOK')
    await identifyAndUse(page)

    await expect(page.locator('#p-currency')).toHaveValue('JPY')
    await expect(page.locator('#p-tax')).toBeChecked()
  })
})

test.describe('add-item: identify puts the price in the matching currency field', () => {
  test('a kr tag fills the NOK field, not the JPY one', async ({ page }) => {
    await page.route('**/api/check-duplicate*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, matches: [] }) })
    )
    await mockIdentifyCustomResult(page, { productName: 'Beast Ball', category: 'figure', price: 2499, currency: 'NOK' })
    await page.goto('/add-item')
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#f-identify-btn').click()
    await page.locator('#f-identify-card .idf-identify-use-btn').click()

    await expect(page.locator('#f-nok')).toHaveValue('2499')
    await expect(page.locator('#f-yen')).toHaveValue('')
  })
})
