import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { mockIdentifyCustomResult } from './helpers/mock-ai'
import { currencyForSource } from '../src/lib/identify-result'

const ALBUM_PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')
const source = (page: import('@playwright/test').Page, value: string) => page.locator(`input[name="p-source"][value="${value}"]`)

test.describe('currency follows the source', () => {
  test('currencyForSource: Japan -> JPY, Norway -> NOK, Online -> unchanged', () => {
    expect(currencyForSource('japanStore', 'USD')).toBe('JPY')
    expect(currencyForSource('norway', 'JPY')).toBe('NOK')
    expect(currencyForSource('online', 'EUR')).toBe('EUR')
  })

  test('/add-price: switching the source sets the currency', async ({ page }) => {
    await page.goto('/add-price')
    await source(page, 'norway').check()
    await expect(page.locator('#p-currency')).toHaveValue('NOK')
    await source(page, 'online').check()
    await expect(page.locator('#p-currency')).toHaveValue('NOK') // Online leaves it alone
    await page.locator('#p-currency').selectOption('USD')
    await source(page, 'japanStore').check()
    await expect(page.locator('#p-currency')).toHaveValue('JPY')
    await expect(page.locator('#p-tax')).toBeVisible() // the JPY-only field follows along
  })

  test('/add-price: a currency Identify read off the tag wins over a later source switch', async ({ page }) => {
    await mockIdentifyCustomResult(page, { productName: 'Flareon Plush', category: 'figure', price: 279, currency: 'NOK' })
    await page.goto('/add-price')
    await page.locator('#p-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#p-identify-btn').click()
    await page.locator('#p-identify-card .idf-identify-use-btn').click()
    await expect(page.locator('#p-currency')).toHaveValue('NOK')

    await source(page, 'online').check()
    await source(page, 'japanStore').check()
    await expect(page.locator('#p-currency')).toHaveValue('NOK') // still the tag's currency

    // Picking a currency by hand ends that — switching the source applies again.
    await page.locator('#p-currency').selectOption('USD')
    await source(page, 'norway').check()
    await expect(page.locator('#p-currency')).toHaveValue('NOK')
    await source(page, 'japanStore').check()
    await expect(page.locator('#p-currency')).toHaveValue('JPY')
  })

  test('/edit-price: an entry keeps its stored currency on load; switching the source sets it', async ({ page, sanity, trackDoc }) => {
    const created = await sanity.create({
      _type: 'priceEntry',
      productName: testName(`Currency follows source ${Date.now()}`),
      category: 'figure',
      sourceType: 'japanStore',
      price: 3300,
      currency: 'USD', // deliberately not what the source implies
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)
    await expect(page.locator('#p-currency')).toHaveValue('USD')

    await source(page, 'norway').check()
    await expect(page.locator('#p-currency')).toHaveValue('NOK')
    await source(page, 'online').check()
    await expect(page.locator('#p-currency')).toHaveValue('NOK')
    await source(page, 'japanStore').check()
    await expect(page.locator('#p-currency')).toHaveValue('JPY')
  })
})
