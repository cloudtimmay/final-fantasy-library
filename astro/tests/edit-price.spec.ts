import { test, expect, testName } from './fixtures'

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
