import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { mockIdentifyCustomResult, mockBarcodeScanner } from './helpers/mock-ai'

const ALBUM_PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')

test.describe('prices list', () => {
  test('search filters by name, expand shows history, and ?open= deep-links to a product', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const matchName = testName(`Searchable Product ${Date.now()}`)
    const matchJan = `49886021${Date.now().toString().slice(-5)}`
    const matched = await sanity.create({
      _type: 'priceEntry',
      productName: matchName,
      jan: matchJan,
      category: 'game',
      sourceType: 'japanStore',
      price: 5000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      note: 'fixture note for list test',
      seenAt: new Date().toISOString(),
    })
    trackDoc(matched._id)

    const otherName = testName(`Other Unrelated Product ${Date.now()}`)
    const other = await sanity.create({
      _type: 'priceEntry',
      productName: otherName,
      category: 'book',
      sourceType: 'japanStore',
      price: 1000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(other._id)

    await page.goto('/prices')

    // Scoped to the Product-grouped view specifically — /prices now also always renders a
    // (hidden-by-default) Person-grouped copy of every product, so an unscoped locator
    // would match both and trip Playwright's strict mode.
    const matchedRow = page.locator('#product-group-view li.price-row', { hasText: matchName })
    const otherRow = page.locator('#product-group-view li.price-row', { hasText: otherName })
    await expect(matchedRow).toBeVisible()
    await expect(otherRow).toBeVisible()

    await page.locator('#p-search').fill(matchName)
    await expect(matchedRow).toBeVisible()
    await expect(otherRow).toBeHidden()

    await matchedRow.locator('summary').click()
    await expect(matchedRow.locator('.history-row').first()).toBeVisible()
    await expect(matchedRow.locator('.history-note').first()).toContainText('fixture note for list test')

    await page.goto(`/prices?open=${encodeURIComponent(matchJan)}`)
    await expect(page.locator(`#product-group-view details[data-key="${matchJan}"]`)).toHaveJSProperty('open', true)
  })
})

test.describe('prices: filters and grouping', () => {
  test('Person filter shows only matching products', async ({ page, trackDoc, sanity }) => {
    const kimName = testName(`Kim Product ${Date.now()}`)
    const kim = await sanity.create({
      _type: 'priceEntry', productName: kimName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(kim._id)

    const toneName = testName(`Tone Product ${Date.now()}`)
    const tone = await sanity.create({
      _type: 'priceEntry', productName: toneName, category: 'game', sourceType: 'japanStore',
      price: 2000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Tone',
      seenAt: new Date().toISOString(),
    })
    trackDoc(tone._id)

    await page.goto('/prices')
    const kimRow = page.locator('#product-group-view li.price-row', { hasText: kimName })
    const toneRow = page.locator('#product-group-view li.price-row', { hasText: toneName })
    await expect(kimRow).toBeVisible()
    await expect(toneRow).toBeVisible()

    await page.locator('#person-filter .chip', { hasText: 'Kim' }).click()
    await expect(kimRow).toBeVisible()
    await expect(toneRow).toBeHidden()
    await expect(page.locator('#person-filter .chip.active')).toHaveText('Kim')
  })

  test('"No buyer" filter shows only prices without a buyer', async ({ page, trackDoc, sanity }) => {
    const withBuyerName = testName(`Has Buyer Product ${Date.now()}`)
    const withBuyer = await sanity.create({
      _type: 'priceEntry', productName: withBuyerName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(withBuyer._id)

    const noBuyerName = testName(`No Buyer Product ${Date.now()}`)
    const noBuyer = await sanity.create({
      _type: 'priceEntry', productName: noBuyerName, category: 'game', sourceType: 'japanStore',
      price: 2000, currency: 'JPY', condition: 'new', status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(noBuyer._id)

    await page.goto('/prices')
    await page.locator('#person-filter .chip', { hasText: 'No buyer' }).click()
    await expect(page.locator('#product-group-view li.price-row', { hasText: noBuyerName })).toBeVisible()
    await expect(page.locator('#product-group-view li.price-row', { hasText: withBuyerName })).toBeHidden()
  })

  test('Status filter shows only matching prices within a product, updating the cheapest price and +N', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const name = testName(`Status Filter Product ${Date.now()}`)
    const jan = `49886022${Date.now().toString().slice(-5)}`
    // Its own trip, so the exchange rate is known (not whatever the default trip is).
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Prices Rate Trip ${Date.now()}`), jpyToNokRate: 0.05 })
    trackDoc(trip._id)
    const considering = await sanity.create({
      _type: 'priceEntry', productName: name, jan, category: 'game', sourceType: 'japanStore',
      price: 2800, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(considering._id)
    const bought = await sanity.create({
      _type: 'priceEntry', productName: name, jan, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'bought', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(bought._id)

    await page.goto(`/prices?trip=${trip._id}`)
    const row = page.locator('#product-group-view li.price-row', { hasText: name })
    await expect(row.locator('.summary-price')).toHaveText('≈ 140 kr (¥2 800) · Shop')
    await expect(row.locator('.summary-more')).toHaveText('+1')

    // Only the bought price is left: it becomes the cheapest, and there's no "+N".
    await page.locator('#status-filter .chip', { hasText: 'Bought' }).click()
    await expect(row).toBeVisible()
    await expect(row.locator('.summary-price')).toHaveText('≈ 150 kr (¥3 000) · Shop')
    await expect(row.locator('.summary-more')).toBeHidden()
    await row.locator('summary').click()
    await expect(row.locator('.history-item[hidden]')).toHaveCount(1)
  })

  test('Group by Person shows one section per buyer with their matching products', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const kimName = testName(`Group Kim Product ${Date.now()}`)
    const kim = await sanity.create({
      _type: 'priceEntry', productName: kimName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(kim._id)
    const toneName = testName(`Group Tone Product ${Date.now()}`)
    const tone = await sanity.create({
      _type: 'priceEntry', productName: toneName, category: 'game', sourceType: 'japanStore',
      price: 2000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Tone',
      seenAt: new Date().toISOString(),
    })
    trackDoc(tone._id)

    await page.goto('/prices')
    await page.locator('#group-toggle .chip', { hasText: 'Person' }).click()

    await expect(page.locator('#product-group-view')).toBeHidden()
    const personView = page.locator('#person-group-view')
    await expect(personView).toBeVisible()

    const kimSection = personView.locator('.person-section[data-person="Kim"]')
    const toneSection = personView.locator('.person-section[data-person="Tone"]')
    await expect(kimSection.locator('.person-section-title')).toHaveText('Kim')
    await expect(kimSection.locator('li.price-row', { hasText: kimName })).toBeVisible()
    await expect(kimSection.locator('li.price-row', { hasText: toneName })).toHaveCount(0)
    await expect(toneSection.locator('li.price-row', { hasText: toneName })).toBeVisible()
  })

  test('filters combine with search', async ({ page, trackDoc, sanity }) => {
    const kimMatchName = testName(`Combo Match Kim ${Date.now()}`)
    const kimMatch = await sanity.create({
      _type: 'priceEntry', productName: kimMatchName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(kimMatch._id)
    const kimOtherName = testName(`Combo Other Kim ${Date.now()}`)
    const kimOther = await sanity.create({
      _type: 'priceEntry', productName: kimOtherName, category: 'game', sourceType: 'japanStore',
      price: 1500, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(kimOther._id)

    await page.goto('/prices')
    await page.locator('#person-filter .chip', { hasText: 'Kim' }).click()
    await page.locator('#p-search').fill('Combo Match')

    await expect(page.locator('#product-group-view li.price-row', { hasText: kimMatchName })).toBeVisible()
    await expect(page.locator('#product-group-view li.price-row', { hasText: kimOtherName })).toBeHidden()
  })

  test('remembers filter choices after a reload', async ({ page, trackDoc, sanity }) => {
    const toneName = testName(`Persist Tone Product ${Date.now()}`)
    const tone = await sanity.create({
      _type: 'priceEntry', productName: toneName, category: 'game', sourceType: 'japanStore',
      price: 2000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Tone',
      seenAt: new Date().toISOString(),
    })
    trackDoc(tone._id)
    const kimName = testName(`Persist Kim Product ${Date.now()}`)
    const kim = await sanity.create({
      _type: 'priceEntry', productName: kimName, category: 'game', sourceType: 'japanStore',
      price: 3000, currency: 'JPY', condition: 'new', status: 'considering', buyer: 'Kim',
      seenAt: new Date().toISOString(),
    })
    trackDoc(kim._id)

    await page.goto('/prices')
    await page.locator('#person-filter .chip', { hasText: 'Tone' }).click()
    await page.locator('#group-toggle .chip', { hasText: 'Person' }).click()
    await expect(page).toHaveURL(/person=Tone/)
    await expect(page).toHaveURL(/group=person/)

    await page.reload()
    await expect(page.locator('#person-filter .chip.active')).toHaveText('Tone')
    await expect(page.locator('#group-toggle .chip.active')).toHaveText('Person')
    await expect(page.locator('#person-group-view')).toBeVisible()
    const toneSection = page.locator('.person-section[data-person="Tone"]')
    await expect(toneSection).toBeVisible()
    await expect(page.locator('.person-section[data-person="Kim"]')).toBeHidden()
  })
})

test.describe('prices: barcode and photo identify', () => {
  test('barcode scan finds a JAN match, filters the list and opens it', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Prices Scan Barcode Product ${Date.now()}`)
    const jan = `49887002${Date.now().toString().slice(-5)}`
    const entry = await sanity.create({
      _type: 'priceEntry', productName, jan, category: 'game', sourceType: 'japanStore',
      price: 4200, currency: 'JPY', condition: 'new', status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)

    await mockBarcodeScanner(page)
    await page.goto('/prices')
    await page.locator('#p-scan-btn').click()
    await page.waitForFunction(() => typeof (window as any).__scannerDecode === 'function')
    await page.evaluate((code) => (window as any).__scannerDecode(code), jan)

    await expect(page.locator('#p-scan-msg')).toContainText('match')
    const row = page.locator('#product-group-view li.price-row', { hasText: productName })
    await expect(row).toBeVisible()
    await expect(page.locator(`#product-group-view details[data-key="${jan}"]`)).toHaveJSProperty('open', true)
  })

  test('photo identify finds a similar-name match, filters the list and opens it', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const suffix = Date.now()
    const productName = testName(`Prices Scan Photo Product ${suffix}`)
    const entry = await sanity.create({
      _type: 'priceEntry', productName, category: 'book', sourceType: 'japanStore',
      price: 1800, currency: 'JPY', condition: 'new', status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)

    await mockIdentifyCustomResult(page, { productName: `prices scan photo product ${suffix}`, jan: null })
    await page.goto('/prices')
    await page.locator('#p-photo-gallery').setInputFiles(ALBUM_PHOTO)

    await expect(page.locator('#p-identified-line')).toContainText('prices scan photo product')
    await expect(page.locator('#p-scan-msg')).toContainText('match')
    const row = page.locator('#product-group-view li.price-row', { hasText: productName })
    await expect(row).toBeVisible()
  })

  test('photo identify with no match in the price list shows a "no match" message', async ({ page }) => {
    const nothingName = `Totally Unmatched Prices Fixture ${Date.now()}`
    await mockIdentifyCustomResult(page, { productName: nothingName, jan: null })
    await page.goto('/prices')
    await page.locator('#p-photo-gallery').setInputFiles(ALBUM_PHOTO)

    await expect(page.locator('#p-identified-line')).toContainText(nothingName)
    await expect(page.locator('#p-scan-msg')).toContainText('No match found')
  })
})

test.describe('prices: navigation row', () => {
  test('"➕ Add price" links to /add-price', async ({ page }) => {
    await page.goto('/prices')
    await page.locator('.nav-row .page-nav-link-add').click()
    await expect(page).toHaveURL(/\/add-price/)
  })

  test('"← Back" falls back to /add-menu when there is no browser history', async ({ page }) => {
    await page.goto('/prices')
    await page.locator('#prices-back').click()
    await expect(page).toHaveURL(/\/add-menu/)
  })

  test('"← Back" uses real browser history when it exists', async ({ page }) => {
    await page.goto('/add-menu')
    await page.goto('/prices')
    await page.locator('#prices-back').click()
    await expect(page).toHaveURL(/\/add-menu/)
  })
})
