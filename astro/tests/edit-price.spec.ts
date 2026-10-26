import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName, uniqueJan } from './fixtures'

const PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')

test.describe('edit-price: prefill', () => {
  test('prefills every field for an online/USD entry', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Prefill Online USD ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'figure',
      sourceType: 'online',
      sourceName: 'Play-Asia',
      url: 'https://www.play-asia.com/test-fixture',
      price: 29.99,
      currency: 'USD',
      taxIncluded: true,
      extraCost: 5.5,
      condition: 'used',
      status: 'considering',
      buyer: 'Tone',
      note: 'test fixture note',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)

    await expect(page.locator('#p-status')).toHaveValue('considering')
    await expect(page.locator('#p-buyer')).toHaveValue('Tone')
    await expect(page.locator('#p-trip')).toHaveValue('')
    await expect(page.locator('input[name="p-source"][value="online"]')).toBeChecked()
    await expect(page.locator('#p-source-name')).toHaveValue('Play-Asia')
    await expect(page.locator('#p-url')).toHaveValue('https://www.play-asia.com/test-fixture')
    await expect(page.locator('#p-price')).toHaveValue('29.99')
    await expect(page.locator('#p-currency')).toHaveValue('USD')
    // Tax-included checkbox is JPY-only; must stay hidden for a USD entry.
    await expect(page.locator('#p-tax')).toBeHidden()
    await expect(page.locator('#p-extra')).toHaveValue('5.5')
    await expect(page.locator('#p-condition')).toHaveValue('used')
    await expect(page.locator('#p-note')).toHaveValue('test fixture note')
  })

  test('prefills a japan-shop source correctly', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Prefill Japan Shop ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 6000,
      currency: 'JPY',
      taxIncluded: false,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)

    await expect(page.locator('input[name="p-source"][value="japanStore"]')).toBeChecked()
    await expect(page.locator('#p-shop')).toBeVisible()
    await expect(page.locator('#p-tax')).toBeVisible()
    await expect(page.locator('#p-tax')).not.toBeChecked()
  })
})

test.describe('edit-price: status, buyer, trip', () => {
  test('"No trip" is selected by default and always available', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`No Trip Default ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'other',
      sourceType: 'japanStore',
      price: 1000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)
    await expect(page.locator('#p-trip')).toHaveValue('')
    await expect(page.locator('#p-trip option', { hasText: 'No trip' })).toHaveCount(1)
  })

  test('marking Bought with a trip creates a familyPurchase and a collection item for the owner', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Kim', budgetNok: 5000, budgetYen: 50000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`Bought With Trip ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 6000,
      currency: 'JPY',
      taxIncluded: true,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)

    await expect(page.locator('#p-buyer')).toHaveValue('Kim')
    const optionValue = await page.locator('#p-trip option', { hasText: tripLabel }).first().getAttribute('value')
    expect(optionValue).toBeTruthy()
    await page.locator('#p-trip').selectOption(optionValue!)
    await page.locator('#p-status').selectOption('bought')
    await expect(page.locator('#p-bought-no-trip-note')).toBeHidden()
    // Paid-with-passport defaults to Kim once Bought is selected.
    await expect(page.locator('#p-passport-field')).toBeVisible()
    await expect(page.locator('#p-passport')).toHaveValue('Kim')

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{
      status: string
      createdFamilyPurchaseId: string | null
      createdItemId: string | null
    }>(
      `*[_id == $id][0]{ status, "createdFamilyPurchaseId": createdFamilyPurchase._ref, "createdItemId": createdItem._ref }`,
      { id: created._id }
    )
    expect(after.status).toBe('bought')
    expect(after.createdFamilyPurchaseId).toBeTruthy()
    expect(after.createdItemId).toBeTruthy()
    trackDoc(after.createdFamilyPurchaseId)
    trackDoc(after.createdItemId)

    const fp = await sanity.fetch<{ person: string; status: string; passportHolder: string }>(
      '*[_id == $id][0]{ person, status, passportHolder }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.person).toBe('Kim')
    expect(fp.status).toBe('bought')
    expect(fp.passportHolder).toBe('Kim')
  })

  test('records a non-default passport holder on the created familyPurchase', async ({ page, trackDoc, sanity }) => {
    const tripLabel = testName(`Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Tone', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`Bought Passport ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 3000,
      currency: 'JPY',
      taxIncluded: true,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)

    await page.locator('#p-buyer').selectOption('Tone')
    const optionValue = await page.locator('#p-trip option', { hasText: tripLabel }).first().getAttribute('value')
    await page.locator('#p-trip').selectOption(optionValue!)
    await page.locator('#p-status').selectOption('bought')
    // Tone's purchase is paid for with Kim's passport by default — override it here.
    await page.locator('#p-passport').selectOption('Kim')

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id: created._id }
    )
    trackDoc(after.createdFamilyPurchaseId)
    const fp = await sanity.fetch<{ person: string; passportHolder: string }>(
      '*[_id == $id][0]{ person, passportHolder }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.person).toBe('Tone')
    expect(fp.passportHolder).toBe('Kim')
  })

  test('marking Bought without a trip skips the familyPurchase but still creates the owner\'s collection item', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const productName = testName(`Bought No Trip Owner ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'book',
      sourceType: 'japanStore',
      price: 1500,
      currency: 'JPY',
      taxIncluded: true,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)

    await expect(page.locator('#p-buyer')).toHaveValue('Kim')
    await expect(page.locator('#p-trip')).toHaveValue('')
    await page.locator('#p-status').selectOption('bought')
    await expect(page.locator('#p-bought-no-trip-note')).toBeVisible()
    await expect(page.locator('#p-bought-no-trip-note')).toContainText('Bought without a trip')

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{
      status: string
      createdFamilyPurchaseId: string | null
      createdItemId: string | null
    }>(
      `*[_id == $id][0]{ status, "createdFamilyPurchaseId": createdFamilyPurchase._ref, "createdItemId": createdItem._ref }`,
      { id: created._id }
    )
    expect(after.status).toBe('bought')
    expect(after.createdFamilyPurchaseId).toBeFalsy()
    expect(after.createdItemId).toBeTruthy()
    trackDoc(after.createdItemId)
  })

  test('marking Bought without a trip for a non-owner only sets the status', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Bought No Trip Non Owner ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 3000,
      currency: 'JPY',
      taxIncluded: true,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)

    await page.locator('#p-buyer').selectOption('Tone')
    await expect(page.locator('#p-trip')).toHaveValue('')
    // Currency is JPY already but a non-owner buyer with no trip creates nothing, so
    // this must be allowed to save even if the currency were something else — verified
    // separately isn't needed here since JPY already satisfies the always-allowed case;
    // the real check is that nothing gets created below.
    await page.locator('#p-status').selectOption('bought')

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{
      status: string
      buyer: string
      createdFamilyPurchaseId: string | null
      createdItemId: string | null
    }>(
      `*[_id == $id][0]{ status, buyer, "createdFamilyPurchaseId": createdFamilyPurchase._ref, "createdItemId": createdItem._ref }`,
      { id: created._id }
    )
    expect(after.status).toBe('bought')
    expect(after.buyer).toBe('Tone')
    expect(after.createdFamilyPurchaseId).toBeFalsy()
    expect(after.createdItemId).toBeFalsy()
  })
})

test.describe('edit-price: passport field only for a Japan shop purchase', () => {
  test('hides the field for an Online source and creates a not-tax-free familyPurchase with no passportHolder', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Online Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Kim', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`Online Bought ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'figure',
      sourceType: 'online',
      sourceName: 'Play-Asia',
      price: 50,
      currency: 'NOK',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)
    await expect(page.locator('#p-passport-field')).toBeHidden()

    const optionValue = await page.locator('#p-trip option', { hasText: tripLabel }).first().getAttribute('value')
    await page.locator('#p-trip').selectOption(optionValue!)
    await page.locator('#p-status').selectOption('bought')
    // Still hidden — Online is never tax-free, so there's nothing to pick a passport for.
    await expect(page.locator('#p-passport-field')).toBeHidden()

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id: created._id }
    )
    trackDoc(after.createdFamilyPurchaseId)
    const fp = await sanity.fetch<{ taxFree: boolean | null; passportHolder: string | null }>(
      '*[_id == $id][0]{ taxFree, passportHolder }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.taxFree).toBe(false)
    expect(fp.passportHolder ?? null).toBeNull()
  })

  test('shows the field for a Japan shop source and saves the chosen passport holder as tax-free', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Japan Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Richard', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`Japan Shop Bought ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 3000,
      currency: 'JPY',
      taxIncluded: true,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)
    await page.locator('#p-buyer').selectOption('Richard')
    const optionValue = await page.locator('#p-trip option', { hasText: tripLabel }).first().getAttribute('value')
    await page.locator('#p-trip').selectOption(optionValue!)
    await page.locator('#p-status').selectOption('bought')

    await expect(page.locator('#p-passport-field')).toBeVisible()
    await page.locator('#p-passport').selectOption('Richard')

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id: created._id }
    )
    trackDoc(after.createdFamilyPurchaseId)
    const fp = await sanity.fetch<{ passportHolder: string; taxFree: boolean | null }>(
      '*[_id == $id][0]{ passportHolder, taxFree }',
      { id: after.createdFamilyPurchaseId }
    )
    expect(fp.passportHolder).toBe('Richard')
    expect(fp.taxFree ?? null).toBeNull() // left unset — tax-free
  })

  test('lets a Japan shop purchase be marked "No passport", creating a not-tax-free familyPurchase with no passportHolder', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Japan No Passport Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Niklas', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const productName = testName(`Japan Shop No Passport ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'game',
      sourceType: 'japanStore',
      price: 500,
      currency: 'JPY',
      taxIncluded: true,
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    await page.goto(`/edit-price?id=${created._id}`)
    await page.locator('#p-buyer').selectOption('Niklas')
    const optionValue = await page.locator('#p-trip option', { hasText: tripLabel }).first().getAttribute('value')
    await page.locator('#p-trip').selectOption(optionValue!)
    await page.locator('#p-status').selectOption('bought')

    await expect(page.locator('#p-passport-field')).toBeVisible()
    await page.locator('#p-passport').selectOption('none')

    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{ createdFamilyPurchaseId: string | null }>(
      `*[_id == $id][0]{ "createdFamilyPurchaseId": createdFamilyPurchase._ref }`,
      { id: created._id }
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

test.describe('edit-price: delete', () => {
  test('deleting a price entry removes it and navigates back to the list', async ({ page, sanity }) => {
    const productName = testName(`Delete Me ${Date.now()}`)
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      category: 'other',
      sourceType: 'japanStore',
      price: 500,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })

    await page.goto(`/edit-price?id=${created._id}`)
    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('#p-delete').click()
    await expect(page).toHaveURL(/\/prices/)

    const stillExists = await sanity.fetch<boolean>('defined(*[_id == $id][0])', { id: created._id })
    expect(stillExists).toBe(false)
    // Not tracked for cleanup via trackDoc — the whole point of this test is that it
    // deletes its own fixture itself.
  })
})

test.describe('edit-price: "Add to" for the owner\'s purchases', () => {
  async function entry(sanity: any, trackDoc: (id: string) => void, fields: Record<string, unknown> = {}) {
    const doc = await sanity.create({
      _type: 'priceEntry', productName: testName(`Add To ${Date.now()} ${Math.random()}`), category: 'game', sourceType: 'norway', sourceName: 'Outland',
      price: 499, currency: 'NOK', condition: 'new', status: 'considering', seenAt: new Date().toISOString(), ...fields,
    })
    trackDoc(doc._id)
    return doc
  }
  const created = (sanity: any, id: string) =>
    sanity.fetch(`*[_id == $id][0]{ status, "createdItemId": createdItem._ref, "createdItemType": createdItem->_type, "fpId": createdFamilyPurchase._ref }`, { id })

  test('shown only for Bought with buyer Kim; defaults to the collection, or Other things for category "other"', async ({ page, sanity, trackDoc }) => {
    const game = await entry(sanity, trackDoc)
    await page.goto(`/edit-price?id=${game._id}`)
    const field = page.locator('#p-addto-field')
    await expect(field).toBeHidden()
    await page.locator('#p-status').selectOption('bought')
    await expect(field).toBeVisible()
    await expect(page.locator('#p-addto')).toHaveValue('collection')
    await page.locator('#p-buyer').selectOption('Tone')
    await expect(field).toBeHidden()

    const other = await entry(sanity, trackDoc, { category: 'other' })
    await page.goto(`/edit-price?id=${other._id}`)
    await page.locator('#p-status').selectOption('bought')
    await expect(page.locator('#p-addto')).toHaveValue('other')
  })

  test('"Other things I own" creates a familyItem for Kim (not a collection item), once; the familyPurchase as today', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const asset = await sanity.assets.upload('image', fs.readFileSync(PHOTO), { filename: 'add-to-test.png' })
    uploadedAssets.push(asset._id)
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Add To Trip ${Date.now()}`), childBudgets: [{ _key: 'k1', person: 'Kim', budgetNok: 5000 }] })
    trackDoc(trip._id)
    const jan = uniqueJan()
    const e = await entry(sanity, trackDoc, {
      productNameJp: 'ガンダム', jan, category: 'figure', image: { _type: 'image', asset: { _type: 'reference', _ref: asset._id } },
    })

    await page.goto(`/edit-price?id=${e._id}`)
    await page.locator('#p-trip').selectOption(trip._id)
    await page.locator('#p-status').selectOption('bought')
    await page.locator('#p-addto').selectOption('other')
    await page.locator('#p-note').fill('Gift from a friend')
    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)

    const after = await created(sanity, e._id)
    trackDoc(after.createdItemId)
    trackDoc(after.fpId)
    expect(after.createdItemType).toBe('familyItem')
    expect(after.fpId).toBeTruthy() // the familyPurchase is still created, as today
    const item = await sanity.fetch(`*[_id == $id][0]{ person, name, nameJp, jan, category, note, "assetId": image.asset._ref }`, { id: after.createdItemId })
    expect(item).toEqual({ person: 'Kim', name: e.productName, nameJp: 'ガンダム', jan, category: 'figure', note: 'Gift from a friend', assetId: asset._id })
    expect(await sanity.fetch(`count(*[_type in ["album", "game", "book", "figure"] && title == $t])`, { t: e.productName })).toBe(0)

    // Saving it as Bought again creates nothing new, and the choice is shown locked.
    await page.goto(`/edit-price?id=${e._id}`)
    await expect(page.locator('#p-addto')).toHaveValue('other')
    await expect(page.locator('#p-addto')).toBeDisabled()
    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)
    expect(await sanity.fetch(`count(*[_type == "familyItem" && name == $n])`, { n: e.productName })).toBe(1)
  })

  test('category "other" goes to Other things by default, also without a trip and in another currency', async ({ page, sanity, trackDoc }) => {
    const e = await entry(sanity, trackDoc, { category: 'other', currency: 'USD', price: 20, sourceType: 'online', sourceName: 'HLJ' })
    await page.goto(`/edit-price?id=${e._id}`)
    await page.locator('#p-status').selectOption('bought')
    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)
    const after = await created(sanity, e._id)
    trackDoc(after.createdItemId)
    expect(after.createdItemType).toBe('familyItem')
    expect(after.fpId ?? null).toBeNull()
  })

  test('"Final Fantasy collection" still creates a collection item', async ({ page, sanity, trackDoc }) => {
    const e = await entry(sanity, trackDoc)
    await page.goto(`/edit-price?id=${e._id}`)
    await page.locator('#p-status').selectOption('bought')
    await page.locator('#p-save').click()
    await expect(page).toHaveURL(/\/prices/)
    const after = await created(sanity, e._id)
    trackDoc(after.createdItemId)
    expect(after.createdItemType).toBe('game')
  })

  test('an unknown addTo value falls back to the category default', async ({ page, sanity, trackDoc }) => {
    const e = await entry(sanity, trackDoc, { category: 'other' })
    const res = await page.request.post('/api/price-entry-update', {
      data: { id: e._id, status: 'bought', buyer: 'Kim', addTo: 'somewhere', sourceType: 'norway', sourceName: 'Outland', price: 499, currency: 'NOK', condition: 'new' },
    })
    expect(res.ok()).toBe(true)
    const after = await created(sanity, e._id)
    trackDoc(after.createdItemId)
    expect(after.createdItemType).toBe('familyItem')
  })
})
