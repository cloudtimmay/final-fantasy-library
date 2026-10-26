import path from 'node:path'
import { test, expect, testName, uniqueJan } from './fixtures'
import { findIdByField } from './helpers/sanity-test-client'
import { mockFindPricesResults, mockFindPricesTwoResults } from './helpers/mock-ai'

test.describe('add-price: new product', () => {
  test('japan shop source', async ({ page, trackDoc }) => {
    const productName = testName(`Japan Shop ${Date.now()}`)
    await page.goto('/add-price')

    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('game')
    await page.locator('#p-price').fill('5980')
    await page.locator('#p-save').click()

    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    expect(id).toBeTruthy()
  })

  test('online source with USD', async ({ page, trackDoc }) => {
    const productName = testName(`Online USD ${Date.now()}`)
    await page.goto('/add-price')

    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('album')
    await page.locator('input[name="p-source"][value="online"]').check()
    await page.locator('#p-source-name').fill('CDJapan')
    await page.locator('#p-url').fill('https://www.cdjapan.co.jp/test-fixture')
    await page.locator('#p-price').fill('42.99')
    await page.locator('#p-currency').selectOption('USD')
    await page.locator('#p-save').click()

    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    expect(id).toBeTruthy()
  })

  test('norway source', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Norway Shop ${Date.now()}`)
    await page.goto('/add-price')

    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('figure')
    await page.locator('input[name="p-source"][value="norway"]').check()
    await page.locator('#p-source-name').fill('Outland')
    await page.locator('#p-price').fill('399')
    await page.locator('#p-currency').selectOption('NOK')
    await page.locator('#p-save').click()

    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    expect(id).toBeTruthy()

    const doc = await sanity.fetch<{ sourceType: string; sourceName: string; currency: string }>(
      '*[_id == $id][0]{ sourceType, sourceName, currency }',
      { id }
    )
    expect(doc.sourceType).toBe('norway')
    expect(doc.sourceName).toBe('Outland')
    expect(doc.currency).toBe('NOK')
  })
})

test.describe('add-price: paid with passport only for a Japan shop purchase', () => {
  test('hides the field for an Online bought purchase and creates a not-tax-free familyPurchase with no passportHolder', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`AP Online Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Kim', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`AP Online Bought ${Date.now()}`)
    await page.goto('/add-price')

    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('album')
    await page.locator('input[name="p-source"][value="online"]').check()
    await page.locator('#p-source-name').fill('CDJapan')
    await page.locator('#p-price').fill('300')
    await page.locator('#p-currency').selectOption('NOK')
    await expect(page.locator('#p-passport-field')).toBeHidden()

    await page.locator('#p-trip').selectOption(trip._id)
    await page.locator('#p-status').selectOption('bought')
    // Still hidden — Online is never tax-free, so there's nothing to pick a passport for.
    await expect(page.locator('#p-passport-field')).toBeHidden()

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id }
    )
    trackDoc(after.createdFamilyPurchaseId)
    const fp = await sanity.fetch<{ taxFree: boolean | null; passportHolder: string | null }>(
      '*[_id == $id][0]{ taxFree, passportHolder }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.taxFree).toBe(false)
    expect(fp.passportHolder ?? null).toBeNull()
  })

  test('shows the field for a Japan shop bought purchase and saves the chosen passport holder as tax-free', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`AP Japan Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Kim', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`AP Japan Shop Bought ${Date.now()}`)
    await page.goto('/add-price')

    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('game')
    await page.locator('#p-price').fill('3000')
    await page.locator('#p-trip').selectOption(trip._id)
    await page.locator('#p-status').selectOption('bought')

    await expect(page.locator('#p-passport-field')).toBeVisible()
    await page.locator('#p-passport').selectOption('Tone')

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id }
    )
    trackDoc(after.createdFamilyPurchaseId)
    const fp = await sanity.fetch<{ passportHolder: string; taxFree: boolean | null }>(
      '*[_id == $id][0]{ passportHolder, taxFree }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.passportHolder).toBe('Tone')
    expect(fp.taxFree ?? null).toBeNull() // left unset — tax-free
  })

  test('lets a Japan shop bought purchase be marked "No passport", creating a not-tax-free familyPurchase', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`AP Japan No Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Kim', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`AP Japan Shop No Passport ${Date.now()}`)
    await page.goto('/add-price')

    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('game')
    await page.locator('#p-price').fill('500')
    await page.locator('#p-trip').selectOption(trip._id)
    await page.locator('#p-status').selectOption('bought')

    await expect(page.locator('#p-passport-field')).toBeVisible()
    await page.locator('#p-passport').selectOption('none')

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id }
    )
    trackDoc(after.createdFamilyPurchaseId)
    const fp = await sanity.fetch<{ taxFree: boolean | null; passportHolder: string | null }>(
      '*[_id == $id][0]{ taxFree, passportHolder }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.taxFree).toBe(false)
    expect(fp.passportHolder ?? null).toBeNull()
  })
})

test.describe('add-price: existing product', () => {
  test('reusing an existing product prefills fields and appends to Seen before', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Existing Product ${Date.now()}`)
    const jan = uniqueJan()
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      productNameJp: 'テスト商品',
      jan,
      category: 'book',
      sourceType: 'japanStore',
      price: 1200,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto('/add-price')

    const optionValue = await page.locator('#p-product option', { hasText: productName }).first().getAttribute('value')
    expect(optionValue).toBeTruthy()
    await page.locator('#p-product').selectOption(optionValue!)

    await expect(page.locator('#p-name')).toHaveValue(productName)
    await expect(page.locator('#p-name-jp')).toHaveValue('テスト商品')
    await expect(page.locator('#p-jan')).toHaveValue(jan)
    await expect(page.locator('#p-category')).toHaveValue('book')
    await expect(page.locator('#p-seen-wrap')).toBeVisible()
    await expect(page.locator('#p-seen-list li')).toHaveCount(1)

    await page.locator('#p-price').fill('1100')
    await page.locator('input[name="p-source"][value="online"]').check()
    await page.locator('#p-source-name').fill('Amiami')
    await page.locator('#p-url').fill('https://www.amiami.com/test-fixture')
    await page.locator('#p-currency').selectOption('USD')
    await page.locator('#p-save').click()

    await expect(page.locator('#p-msg')).toContainText('Saved')

    const newId = await sanity.fetch<string | null>(
      '*[_type == "priceEntry" && productName == $name && price == 1100][0]._id',
      { name: productName }
    )
    trackDoc(newId)
    expect(newId).toBeTruthy()
  })
})

test.describe('add-price: find prices ("Save this price")', () => {
  test('search renders mocked results, saving one shows the summary, and Done resets the form', async ({
    page,
    trackDoc,
  }) => {
    const productName = testName(`Find Prices Flow ${Date.now()}`)
    await mockFindPricesResults(page)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('album')
    await page.locator('input[name="p-source"][value="online"]').check()

    const findBtn = page.locator('#p-find-prices-btn')
    await expect(findBtn).toBeVisible()
    await findBtn.click()

    const resultsWrap = page.locator('#p-find-prices-results')
    await expect(resultsWrap).toBeVisible()
    await expect(resultsWrap).toContainText("Each tap saves that shop's price as its own entry")
    await expect(resultsWrap).toContainText('Prices found by AI search. Check the link.')

    // Class-based, not hasText — the button's own text changes to "Saved ✓" on success,
    // so a locator filtered by its original text would stop matching anything right
    // after the click and every assertion after it would fail to find the element.
    const saveBtn = resultsWrap.locator('.ap-find-prices-log-btn')
    await expect(saveBtn).toHaveText('💾 Save this price')
    await saveBtn.click()

    await expect(saveBtn).toHaveText('Saved ✓')
    await expect(saveBtn).toBeDisabled()

    const summary = resultsWrap.locator('.ap-find-prices-summary')
    await expect(summary).toContainText(`1 price saved for ${productName}`)
    await expect(summary.locator('a', { hasText: 'View in All prices' })).toBeVisible()

    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    expect(id).toBeTruthy()

    await summary.locator('button', { hasText: 'Done' }).click()
    await expect(page.locator('#p-name')).toHaveValue('')
    await expect(resultsWrap).toBeHidden()
  })
})

test.describe('add-price: find prices photo handling', () => {
  test('Save this price uploads a freshly-taken photo once and reuses the same asset for a second entry', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const productName = testName(`Find Prices Photo ${Date.now()}`)
    await mockFindPricesTwoResults(page)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('album')
    await page.locator('input[name="p-source"][value="online"]').check()

    const photoPath = path.join(__dirname, '..', 'public', 'icons', 'album.png')
    await page.locator('#p-photo-gallery').setInputFiles(photoPath)
    await expect(page.locator('#p-preview')).toBeVisible()

    await page.locator('#p-find-prices-btn').click()
    const resultsWrap = page.locator('#p-find-prices-results')
    await expect(resultsWrap).toBeVisible()

    const saveButtons = resultsWrap.locator('.ap-find-prices-log-btn')
    await expect(saveButtons).toHaveCount(2)

    await saveButtons.nth(0).click()
    await expect(saveButtons.nth(0)).toHaveText('Saved ✓')
    // The photo must stay in the form — only a form reset (Done / normal Save) clears it.
    await expect(page.locator('#p-preview')).toBeVisible()

    await saveButtons.nth(1).click()
    await expect(saveButtons.nth(1)).toHaveText('Saved ✓')

    const docs = await sanity.fetch<{ _id: string; price: number; assetId: string | null }[]>(
      `*[_type == "priceEntry" && productName == $name] | order(price asc) { _id, price, "assetId": image.asset._ref }`,
      { name: productName }
    )
    expect(docs.length).toBe(2)
    docs.forEach((d) => trackDoc(d._id))
    if (docs[0]?.assetId) trackDoc(docs[0].assetId) // the uploaded Sanity image asset itself

    expect(docs[0].assetId).toBeTruthy()
    expect(docs[1].assetId).toBeTruthy()
    // Same asset on both — proves the second "Save this price" reused the upload from
    // the first instead of uploading the file again.
    expect(docs[0].assetId).toBe(docs[1].assetId)
  })
})

test.describe('add-price: find prices "Searched for" line', () => {
  test('reflects the current form values, including JAN when present', async ({ page }) => {
    const productName = testName(`Searched For ${Date.now()}`)
    await mockFindPricesResults(page)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)
    await page.locator('#p-jan').fill('4988601112223')
    await page.locator('#p-category').selectOption('game')
    await page.locator('input[name="p-source"][value="online"]').check()

    await page.locator('#p-find-prices-btn').click()
    const resultsWrap = page.locator('#p-find-prices-results')
    await expect(resultsWrap).toBeVisible()

    const searchedForLine = resultsWrap.locator('.ap-find-prices-searched-for')
    await expect(searchedForLine).toHaveText(`Searched for: ${productName} · 4988601112223 · Game (by JAN)`)
  })

  test('omits "(by JAN)" when no JAN was entered', async ({ page }) => {
    const productName = testName(`Searched For No JAN ${Date.now()}`)
    await mockFindPricesResults(page)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('book')
    await page.locator('input[name="p-source"][value="online"]').check()

    await page.locator('#p-find-prices-btn').click()
    const resultsWrap = page.locator('#p-find-prices-results')
    await expect(resultsWrap).toBeVisible()

    const searchedForLine = resultsWrap.locator('.ap-find-prices-searched-for')
    await expect(searchedForLine).toHaveText(`Searched for: ${productName} · Book`)
  })
})

test.describe('add-price: duplicate name warning', () => {
  test('warns on a matching name', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Duplicate Check ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 2000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)

    await expect(page.locator('#p-name-warning')).toBeVisible()
    await expect(page.locator('#p-name-warning')).toContainText(productName)
    await expect(page.locator('#p-name-warning button', { hasText: 'Use existing' })).toBeVisible()
  })

  test('clicking "Use existing" selects the product and fills its fields', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Duplicate Check Click ${Date.now()}`)
    const jan = uniqueJan()
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      productNameJp: 'クリックテスト',
      jan,
      category: 'game',
      sourceType: 'japanStore',
      price: 2000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)
    await expect(page.locator('#p-name-warning')).toBeVisible()

    await page.locator('#p-name-warning button', { hasText: 'Use existing' }).click()

    await expect(page.locator('#p-product')).not.toHaveValue('')
    await expect(page.locator('#p-name')).toHaveValue(productName)
    await expect(page.locator('#p-name-jp')).toHaveValue('クリックテスト')
    await expect(page.locator('#p-jan')).toHaveValue(jan)
    await expect(page.locator('#p-category')).toHaveValue('game')
    await expect(page.locator('#p-name-warning')).toBeHidden()
  })
})

test.describe('add-price: navigation', () => {
  test('"All prices" link goes to /prices', async ({ page }) => {
    await page.goto('/add-price')
    await page.locator('a.all-prices-link').click()
    await expect(page).toHaveURL(/\/prices/)
  })
})

test.describe('add-price: "already has this" note', () => {
  test('typing a name matching a familyItem shows a non-blocking note, by name and by JAN', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const suffix = Date.now()
    const name = testName(`Family Owns This ${suffix}`)
    const jan = `49887004${suffix.toString().slice(-5)}`
    const item = await sanity.create({ _type: 'familyItem', person: 'Kristina', name, jan, category: 'book' })
    trackDoc(item._id)

    await page.goto('/add-price')

    await page.locator('#p-name').fill(name)
    const note = page.locator('#p-owned-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText('Kristina already has this')

    // Clearing the name hides it again — it's keyed off the live input, not a one-shot check.
    await page.locator('#p-name').fill('')
    await expect(note).toBeHidden()

    // A JAN-only match (different name) still finds it, labelled "Same barcode".
    await page.locator('#p-jan').fill(jan)
    await expect(note).toBeVisible()
    await expect(note).toContainText('Same barcode')
  })

  test('does not block saving a price entry', async ({ page, trackDoc, sanity }) => {
    const suffix = Date.now()
    const name = testName(`Family Owns Save Anyway ${suffix}`)
    const item = await sanity.create({ _type: 'familyItem', person: 'Richard', name, category: 'album' })
    trackDoc(item._id)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(name)
    await expect(page.locator('#p-owned-note')).toBeVisible()

    await page.locator('#p-category').selectOption('album')
    await page.locator('#p-price').fill('1000')
    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')

    const id = await findIdByField('priceEntry', 'productName', name)
    trackDoc(id)
    expect(id).toBeTruthy()
  })
})

test.describe('add-price: "Add to" for the owner\'s purchases', () => {
  test('follows the category (other -> Other things) until changed; "Other things I own" creates a familyItem for Kim', async ({ page, sanity, trackDoc }) => {
    const productName = testName(`AP Add To ${Date.now()}`)
    await page.goto('/add-price')
    await page.locator('#p-name').fill(productName)
    await page.locator('#p-category').selectOption('other')
    await page.locator('input[name="p-source"][value="norway"]').check()
    await page.locator('#p-source-name').fill('Outland')
    await page.locator('#p-price').fill('350')
    await page.locator('#p-currency').selectOption('NOK')

    const field = page.locator('#p-addto-field')
    await expect(field).toBeHidden() // Considering
    await page.locator('#p-status').selectOption('bought')
    await expect(field).toBeVisible()
    await expect(page.locator('#p-addto')).toHaveValue('other')
    await page.locator('#p-category').selectOption('figure')
    await expect(page.locator('#p-addto')).toHaveValue('collection')
    await page.locator('#p-buyer').selectOption('Niklas')
    await expect(field).toBeHidden()
    await page.locator('#p-buyer').selectOption('Kim')

    await page.locator('#p-addto').selectOption('other')
    await page.locator('#p-category').selectOption('game') // chosen by hand: stays
    await expect(page.locator('#p-addto')).toHaveValue('other')

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')
    const id = await findIdByField('priceEntry', 'productName', productName)
    trackDoc(id)
    const after = await sanity.fetch(`*[_id == $id][0]{ status, "createdItemId": createdItem._ref, "type": createdItem->_type, "person": createdItem->person }`, { id })
    trackDoc(after.createdItemId)
    expect(after).toMatchObject({ status: 'bought', type: 'familyItem', person: 'Kim' })
  })
})
