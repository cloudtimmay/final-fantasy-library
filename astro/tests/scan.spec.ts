import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { mockIdentifyCustomResult, mockIdentifyNoResult, mockBarcodeScanner } from './helpers/mock-ai'

const ALBUM_PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')

test.describe('scan: barcode and photo identify against the price list', () => {
  test('barcode decode finds a JAN match, shown as "Same barcode", linking to /prices?open=', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const productName = testName(`Barcode Match Product ${Date.now()}`)
    const jan = `49887001${Date.now().toString().slice(-5)}`
    const entry = await sanity.create({
      _type: 'priceEntry',
      productName,
      jan,
      category: 'game',
      sourceType: 'japanStore',
      price: 4500,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)

    await mockBarcodeScanner(page)
    await page.goto('/scan')
    await page.locator('#scan-toggle').click()
    await page.waitForFunction(() => typeof (window as any).__scannerDecode === 'function')

    await Promise.all([
      page.waitForURL(/\/scan\?/),
      page.evaluate((code) => (window as any).__scannerDecode(code), jan),
    ])

    await expect(page.locator('.identified-line')).toContainText(`JAN ${jan}`)

    const matchRow = page.locator('.price-match-row', { hasText: productName })
    await expect(matchRow).toBeVisible()
    await expect(matchRow.locator('.price-match-badge')).toHaveText('Same barcode')
    await expect(matchRow).toHaveAttribute('href', `/prices?open=${encodeURIComponent(jan)}`)

    await matchRow.click()
    await expect(page).toHaveURL(`/prices?open=${encodeURIComponent(jan)}`)
    await expect(page.locator(`#product-group-view details[data-key="${jan}"]`)).toHaveJSProperty('open', true)
  })

  test('photo identify finds a similar-name match, shown as "Similar name"', async ({ page, trackDoc, sanity }) => {
    const suffix = Date.now()
    const productName = testName(`Similar Name Match ${suffix}`)
    const entry = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 3200,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)

    await mockIdentifyCustomResult(page, { productName: `similar   name - match ${suffix}`, jan: null })
    await page.goto('/scan')

    await Promise.all([
      page.waitForURL(/\/scan\?/),
      page.locator('#scan-photo-gallery').setInputFiles(ALBUM_PHOTO),
    ])

    await expect(page.locator('.identified-line')).toContainText('similar   name - match')

    const matchRow = page.locator('.price-match-row', { hasText: productName })
    await expect(matchRow).toBeVisible()
    await expect(matchRow.locator('.price-match-badge')).toHaveText('Similar name')
  })

  test('photo identify with no match in the price list shows no "In your price list" section', async ({
    page,
  }) => {
    const nothingName = `Totally Unmatched Nonexistent Fixture ${Date.now()}`
    await mockIdentifyCustomResult(page, { productName: nothingName, jan: null })
    await page.goto('/scan')

    await Promise.all([
      page.waitForURL(/\/scan\?/),
      page.locator('#scan-photo-gallery').setInputFiles(ALBUM_PHOTO),
    ])

    await expect(page.locator('.identified-line')).toContainText(nothingName)
    await expect(page.locator('.price-matches')).toHaveCount(0)
  })

  test('photo identify with an unusable result shows a message instead of navigating', async ({ page }) => {
    await mockIdentifyNoResult(page)
    await page.goto('/scan')
    await page.locator('#scan-photo-gallery').setInputFiles(ALBUM_PHOTO)

    await expect(page.locator('#scan-identify-msg')).toContainText('Could not identify')
    await expect(page).toHaveURL('/scan')
  })
})
