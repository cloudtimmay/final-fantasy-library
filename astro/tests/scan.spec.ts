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

test.describe('scan: "already has this" (family items and bought purchases)', () => {
  test('a JAN match against a familyItem shows "<person> already has this" with a "Same barcode" badge', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const name = testName(`Family Item Barcode ${Date.now()}`)
    const jan = `49887003${Date.now().toString().slice(-5)}`
    const item = await sanity.create({ _type: 'familyItem', person: 'Tone', name, jan, category: 'game' })
    trackDoc(item._id)

    await mockBarcodeScanner(page)
    await page.goto('/scan')
    await page.locator('#scan-toggle').click()
    await page.waitForFunction(() => typeof (window as any).__scannerDecode === 'function')
    await Promise.all([
      page.waitForURL(/\/scan\?/),
      page.evaluate((code) => (window as any).__scannerDecode(code), jan),
    ])

    const line = page.locator('.owner-match-line', { hasText: 'Tone' })
    await expect(line).toBeVisible()
    await expect(line).toContainText('already has this')
    await expect(line.locator('.owner-match-badge')).toHaveText('Same barcode')
  })

  test('a name match against a bought priceEntry for a non-owner also shows "already has this"', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const suffix = Date.now()
    const productName = testName(`Bought By Niklas ${suffix}`)
    const entry = await sanity.create({
      _type: 'priceEntry', productName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'bought', buyer: 'Niklas',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)

    await mockIdentifyCustomResult(page, { productName: `bought by niklas ${suffix}`, jan: null })
    await page.goto('/scan')
    await Promise.all([
      page.waitForURL(/\/scan\?/),
      page.locator('#scan-photo-gallery').setInputFiles(ALBUM_PHOTO),
    ])

    const line = page.locator('.owner-match-line', { hasText: 'Niklas' })
    await expect(line).toBeVisible()
    await expect(line.locator('.owner-match-badge')).toHaveCount(0)
  })

  test('a bought priceEntry for Kim (the collection owner) never shows an "already has this" line', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const suffix = Date.now()
    const productName = testName(`Bought By Kim ${suffix}`)
    const entry = await sanity.create({
      _type: 'priceEntry', productName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'bought', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)

    await mockIdentifyCustomResult(page, { productName: `bought by kim ${suffix}`, jan: null })
    await page.goto('/scan')
    await Promise.all([
      page.waitForURL(/\/scan\?/),
      page.locator('#scan-photo-gallery').setInputFiles(ALBUM_PHOTO),
    ])

    await expect(page.locator('.owner-matches')).toHaveCount(0)
  })
})

test.describe('scan: merchandise/figure search', () => {
  test('a figure shows up in collection results and links to /merchandise/<id>', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Scan Figure ${Date.now()}`)
    const figure = await sanity.create({ _type: 'figure', title, manufacturer: 'Square Enix', status: 'owned' })
    trackDoc(figure._id)

    await page.goto(`/scan?q=${encodeURIComponent(title)}`)
    const row = page.locator('.result-row', { hasText: title })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Square Enix')
    await expect(row).toHaveAttribute('href', `/merchandise/${figure._id}`)
  })

  test('shows a "Merch" external lookup group', async ({ page }) => {
    await page.goto('/scan?q=test')
    const group = page.locator('.ext-group', { hasText: 'Merch' })
    await expect(group).toBeVisible()
    await expect(group.locator('a', { hasText: 'MyFigureCollection' })).toBeVisible()
  })
})

test.describe('scan: wishlist callout', () => {
  test('shows "On your wishlist" with a working "Got it" button', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Scan Wishlist Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, status: 'wishlist' })
    trackDoc(game._id)

    await page.goto(`/scan?q=${encodeURIComponent(title)}`)
    const banner = page.locator('.wish-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('On your wishlist')
    await expect(banner).toContainText(title)

    // Still shown with its WISHLIST badge in the results list below.
    await expect(page.locator('.result-row', { hasText: title }).locator('.badge.wishlist')).toBeVisible()

    await banner.locator('#scan-got-it').click()
    await expect(page.locator('.wish-banner')).toHaveCount(0)
    await expect(page.locator('.result-row', { hasText: title }).locator('.badge.owned')).toBeVisible()
  })

  test('shows no wishlist callout when nothing matches', async ({ page }) => {
    await page.goto(`/scan?q=${encodeURIComponent(testName(`Nonexistent ${Date.now()}`))}`)
    await expect(page.locator('.wish-banner')).toHaveCount(0)
  })
})
