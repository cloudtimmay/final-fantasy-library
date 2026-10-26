import fs from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, testName, uniqueJan } from './fixtures'
import { PERSON, OTHER, PHOTO, section, famRow, familyItem } from './helpers/family'

async function trip(sanity: any, trackDoc: (id: string) => void) {
  const t = await sanity.create({ _type: 'tripSettings', label: testName(`Family Trip ${Date.now()}`) })
  trackDoc(t._id)
  return t
}

// Replaces the shared camera scanner (public/barcode-scanner.js) with one that "scans" `code`.
async function fakeScanner(page: Page, code: string) {
  await page.route('**/barcode-scanner.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.createBarcodeScanner = function () {
        let running = false
        return {
          isRunning: () => running,
          start: async (onCode) => { running = true; setTimeout(() => onCode(${JSON.stringify(code)}), 0) },
          stop: async () => { running = false },
        }
      }`,
    })
  )
}

test.describe('/family: what each family member owns', () => {
  test('lists the person\'s family items and bought purchases, with category, note and "Bought in Japan · <trip>"', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const asset = await sanity.assets.upload('image', fs.readFileSync(PHOTO), { filename: 'family-test.png' })
    uploadedAssets.push(asset._id)
    const item = await familyItem(sanity, trackDoc, {
      category: 'book', note: 'Signed by the author\nSecond line', image: { _type: 'image', asset: { _type: 'reference', _ref: asset._id } },
    })
    const t = await trip(sanity, trackDoc)
    const bought = await sanity.create({ _type: 'familyPurchase', person: PERSON, name: testName(`Bought Thing ${Date.now()}`), trip: { _type: 'reference', _ref: t._id }, status: 'bought' })
    trackDoc(bought._id)
    const planned = await sanity.create({ _type: 'familyPurchase', person: PERSON, name: testName(`Planned Thing ${Date.now()}`), trip: { _type: 'reference', _ref: t._id }, status: 'planned' })
    trackDoc(planned._id)
    const others = await familyItem(sanity, trackDoc, { person: OTHER })

    await page.goto(`/family?person=${PERSON}`)
    const row = famRow(page, item.name)
    await expect(row.locator('.cat-icon')).toHaveAttribute('aria-label', 'Book')
    await expect(row.locator('.fam-note')).toHaveText('Signed by the author') // first line only
    await expect(row.locator('a.fam-row-link')).toHaveAttribute('href', `/edit-family-item?id=${item._id}`)

    const boughtRow = famRow(page, bought.name)
    await expect(boughtRow.locator('.fam-origin')).toHaveText(`Bought in Japan · ${t.label}`)
    await expect(boughtRow.locator('a')).toHaveCount(0) // not editable here

    await expect(famRow(page, planned.name)).toHaveCount(0) // only bought purchases
    await expect(famRow(page, others.name)).toBeHidden() // another person's
    await expect(famRow(page, others.name, OTHER)).toHaveCount(1)

    // Tapping the photo opens it full screen instead of the edit form.
    await row.locator('img.thumb').click()
    await expect(page.locator('.lb-dialog')).toBeVisible()
    await expect(page).toHaveURL(/\/family\?person=Tone/)
  })

  test('a price bought for the person without a trip is listed; one that created a purchase is listed once', async ({ page, sanity, trackDoc }) => {
    const base = { _type: 'priceEntry', category: 'game', sourceType: 'norway', price: 100, currency: 'NOK', status: 'bought', buyer: PERSON, seenAt: new Date().toISOString() }
    const noTrip = await sanity.create({ ...base, productName: testName(`No Trip Buy ${Date.now()}`), note: 'From a sale' })
    trackDoc(noTrip._id)
    const t = await trip(sanity, trackDoc)
    const fp = await sanity.create({ _type: 'familyPurchase', person: PERSON, name: testName(`With Trip Buy ${Date.now()}`), trip: { _type: 'reference', _ref: t._id }, status: 'bought' })
    trackDoc(fp._id)
    const withTrip = await sanity.create({
      ...base, productName: fp.name, category: 'album', note: 'Note from the price',
      createdFamilyPurchase: { _type: 'reference', _ref: fp._id, _weak: true },
    })
    trackDoc(withTrip._id)

    await page.goto(`/family?person=${PERSON}`)
    await expect(famRow(page, noTrip.productName).locator('.fam-origin')).toHaveText('Bought')
    await expect(famRow(page, noTrip.productName).locator('.fam-note')).toHaveText('From a sale')
    const once = famRow(page, fp.name)
    await expect(once).toHaveCount(1)
    await expect(once.locator('.fam-origin')).toHaveText(`Bought in Japan · ${t.label}`)
    // The purchase has no category/note of its own: they come from the price that created it.
    await expect(once.locator('.cat-icon')).toHaveAttribute('aria-label', 'Album')
    await expect(once.locator('.fam-note')).toHaveText('Note from the price')
  })

  test('person selector: ?person= picks the person, the choice is remembered, and ➕ Add follows it', async ({ page, sanity, trackDoc }) => {
    const mine = await familyItem(sanity, trackDoc, { person: OTHER })
    await page.goto(`/family?person=${PERSON}`)
    await expect(page.locator('#fam-person .chip.active')).toHaveText(PERSON)
    await expect(page.locator('#fam-add')).toHaveAttribute('href', `/add-item?owner=${PERSON}`)
    await expect(page.locator('#fam-person .chip', { hasText: 'Kim' })).toHaveCount(0) // the owner has the collection

    await page.locator('#fam-person .chip', { hasText: OTHER }).click()
    await expect(famRow(page, mine.name, OTHER)).toBeVisible()
    await expect(section(page, PERSON)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`person=${OTHER}`))
    await expect(page.locator('#fam-add')).toHaveAttribute('href', `/add-item?owner=${OTHER}`)

    await page.goto('/family') // no ?person=: the remembered one
    await expect(page.locator('#fam-person .chip.active')).toHaveText(OTHER)
    await expect(famRow(page, mine.name, OTHER)).toBeVisible()
  })

  test('search by name, Japanese name, barcode and note', async ({ page, sanity, trackDoc }) => {
    const marker = `zq${Date.now()}`
    const jan = uniqueJan()
    const item = await familyItem(sanity, trackDoc, { nameJp: `テスト${marker}`, jan, note: `Gift from grandma ${marker}x` })
    await page.goto(`/family?person=${PERSON}`)
    const row = famRow(page, item.name)
    const search = page.locator('#fam-search')

    for (const term of [item.name.slice(7), `テスト${marker}`, jan, `grandma ${marker}X`]) {
      await search.fill(term)
      await expect(row, term).toBeVisible()
    }
    await search.fill(`nothing-${marker}-at-all`)
    await expect(row).toBeHidden()
    await expect(section(page).locator('.empty-filtered')).toBeVisible()
  })

  test('barcode scan: "Already has this" for the person\'s own item, "No match" for another person\'s', async ({ page, sanity, trackDoc }) => {
    const jan = uniqueJan()
    const item = await familyItem(sanity, trackDoc, { jan })
    const othersJan = uniqueJan()
    await familyItem(sanity, trackDoc, { person: OTHER, jan: othersJan })

    await fakeScanner(page, jan)
    await page.goto(`/family?person=${PERSON}`)
    await page.locator('#fam-scan-btn').click()
    await expect(page.locator('#fam-match')).toContainText(`Already has this: ${item.name} (same barcode)`)
    await expect(famRow(page, item.name)).toBeVisible()
    await expect(section(page).locator('.fam-row:not([hidden])')).toHaveCount(1) // only the match

    await page.locator('#fam-match-clear').click()
    await expect(page.locator('#fam-match')).toBeHidden()

    // Niklas has this one, Tone doesn't: matching is within the selected person's items only.
    await page.unroute('**/barcode-scanner.js')
    await fakeScanner(page, othersJan)
    await page.reload()
    await page.locator('#fam-scan-btn').click()
    await expect(page.locator('#fam-match')).toHaveText(/No match: Tone doesn't have this yet\./)
  })

  test('"Identify by photo": a similar name counts as "Already has this"', async ({ page, sanity, trackDoc }) => {
    const item = await familyItem(sanity, trackDoc, { name: testName(`Moogle Plush Deluxe ${Date.now()}`) })
    await page.route('**/api/identify-product', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { productName: item.name.slice(7) } }) })
    )
    await page.goto(`/family?person=${PERSON}`)
    await page.locator('#fam-photo-gallery').setInputFiles(PHOTO)
    await expect(page.locator('#fam-identified-line')).toContainText(item.name.slice(7))
    await expect(page.locator('#fam-match')).toContainText(`Already has this: ${item.name} (similar name)`)
  })
})

test.describe('/add-item?owner=', () => {
  test('preselects the owner from the parameter (a family member gets the family-item form)', async ({ page }) => {
    await page.goto(`/add-item?owner=${PERSON}`)
    await expect(page.locator('#f-owner')).toHaveValue(PERSON)
    await expect(page.locator('#f-save')).toHaveText('Save family item')
  })

  test('an unknown owner falls back to the collection owner', async ({ page }) => {
    await page.goto('/add-item?owner=Nobody')
    await expect(page.locator('#f-owner')).toHaveValue('Kim')
  })
})
