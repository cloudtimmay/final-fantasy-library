import { test, expect, testName } from './fixtures'

test.describe('spending page', () => {
  test('loads without the old "My FF collection" section', async ({ page }) => {
    await page.goto('/spending')
    await expect(page.locator('h1')).toHaveText('Spending')
    await expect(page.locator('h2', { hasText: 'My FF collection' })).toHaveCount(0)
    await expect(page.locator('#total-combined')).toHaveCount(0)
  })

  test('shows the trip rate as read-only text, not an editable input', async ({ page }) => {
    await page.goto('/spending')
    await expect(page.locator('#rate')).toHaveCount(0)
    await expect(page.locator('.rate-note')).toContainText('change in Trip Settings')
  })
})

test.describe('spending: default trip selection', () => {
  test('defaults to the trip ongoing today over an upcoming or past one', async ({ page, trackDoc, sanity }) => {
    const dayMs = 24 * 60 * 60 * 1000
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString().split('T')[0]

    const ongoingLabel = testName(`Ongoing Trip ${Date.now()}`)
    const upcomingLabel = testName(`Upcoming Trip ${Date.now()}`)
    const pastLabel = testName(`Past Trip ${Date.now()}`)

    const ongoing = await sanity.create({ _type: 'tripSettings', label: ongoingLabel, startDate: iso(-dayMs), endDate: iso(dayMs) })
    const upcoming = await sanity.create({ _type: 'tripSettings', label: upcomingLabel, startDate: iso(7 * dayMs), endDate: iso(8 * dayMs) })
    const past = await sanity.create({ _type: 'tripSettings', label: pastLabel, startDate: iso(-8 * dayMs), endDate: iso(-7 * dayMs) })
    trackDoc(ongoing._id)
    trackDoc(upcoming._id)
    trackDoc(past._id)

    await page.goto('/spending')
    await expect(page.locator('a.trip-btn.active')).toHaveText(ongoingLabel)
  })
})

test.describe('spending: person cards', () => {
  test('shows bought/budget, planned, remaining, an over-budget warning, and the duty-free comparison', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Person Card Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      jpyToNokRate: 0.07,
      childBudgets: [{ _key: 'k1', person: 'Tone', budgetNok: 900 }],
    })
    trackDoc(trip._id)

    const bought = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Bought A ${Date.now()}`),
      person: 'Tone',
      status: 'bought',
      priceNok: 700,
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(bought._id)

    const plannedFp = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Planned FP ${Date.now()}`),
      person: 'Tone',
      status: 'planned',
      priceNok: 300,
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(plannedFp._id)

    const plannedPe = await sanity.create({
      _type: 'priceEntry',
      productName: testName(`Planned PE ${Date.now()}`),
      category: 'game',
      sourceType: 'japanStore',
      price: 100,
      currency: 'NOK',
      condition: 'new',
      status: 'considering',
      buyer: 'Tone',
      trip: { _type: 'reference', _ref: trip._id },
      seenAt: new Date().toISOString(),
    })
    trackDoc(plannedPe._id)

    await page.goto(`/spending?trip=${trip._id}`)
    const card = page.locator('.person-card[data-person="Tone"]')
    await expect(card).toBeVisible()
    // bought 700 (≈¥10,000 at rate 0.07) / budget 900 (≈¥12,900)
    await expect(card).toContainText('700 kr (≈ ¥10,000) / 900 kr (≈ ¥12,900)')
    // planned: 300 (familyPurchase) + 100 (priceEntry, no barcode match) = 400 (≈¥5,700)
    await expect(card).toContainText('+400 kr planned (≈ ¥5,700)')
    // remaining = budget(900) - bought(700) = 200 (≈¥2,900)
    await expect(card).toContainText('200 kr left (≈ ¥2,900)')
    // bought(700) + planned(400) = 1100 > budget(900)
    await expect(card.locator('.person-warning')).toBeVisible()
    await expect(card.locator('.person-warning')).toContainText('exceed the budget')
    // duty-free: 700 bought vs. the 6000 NOK constant — under
    await expect(card.locator('.person-duty-free')).toContainText('700 kr / 6000 kr allowance')
    await expect(card.locator('.person-duty-free')).toContainText('under')
    await expect(card.locator('.person-duty-free')).not.toHaveClass(/over/)
    await expect(card.locator('.duty-free-hint')).toContainText('toll.no')
  })

  test('does not double-count a planned priceEntry and a planned familyPurchase sharing the same barcode', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Dedup Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      jpyToNokRate: 0.07,
      childBudgets: [{ _key: 'k1', person: 'Richard', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    const sharedBarcode = '4988601' + Date.now().toString().slice(-6)
    const plannedFp = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Dedup FP ${Date.now()}`),
      person: 'Richard',
      status: 'planned',
      priceNok: 800,
      barcode: sharedBarcode,
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(plannedFp._id)

    const plannedPe = await sanity.create({
      _type: 'priceEntry',
      productName: testName(`Dedup PE ${Date.now()}`),
      jan: sharedBarcode,
      category: 'game',
      sourceType: 'japanStore',
      price: 800,
      currency: 'NOK',
      condition: 'new',
      status: 'considering',
      buyer: 'Richard',
      trip: { _type: 'reference', _ref: trip._id },
      seenAt: new Date().toISOString(),
    })
    trackDoc(plannedPe._id)

    await page.goto(`/spending?trip=${trip._id}`)
    const card = page.locator('.person-card[data-person="Richard"]')
    await expect(card).toBeVisible()
    // Only 800, not 1600 — the matching-barcode priceEntry is dropped from the total.
    await expect(card).toContainText('+800 kr planned')
    await expect(card).not.toContainText('1 600 kr')
    await expect(card).not.toContainText('1600 kr')
  })
})

test.describe('spending: trip frame', () => {
  test('shows bought vs budget and a separate +planned figure', async ({ page, trackDoc, sanity }) => {
    const tripLabel = testName(`Frame Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      budgetNok: 10000,
      jpyToNokRate: 0.07,
    })
    trackDoc(trip._id)

    const bought = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Bought Item ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 10000, // * 0.07 = 700 NOK
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(bought._id)
    const planned = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Planned Item ${Date.now()}`),
      person: 'Kim',
      status: 'planned',
      priceNok: 500,
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(planned._id)

    await page.goto(`/spending?trip=${trip._id}`)
    await expect(page.locator('.rate-note')).toContainText('1 JPY = 0.07 NOK')

    const frame = page.locator('#frame-card')
    await expect(frame).toBeVisible()
    // 10,000 NOK budget -> ≈¥142,900 at rate 0.07. The NOK side isn't asserted with its
    // exact thousands separator here — nb-NO's grouping character can be a regular or a
    // non-breaking space depending on the ICU data in use, which makes it an unreliable
    // thing to hardcode in a test.
    await expect(frame).toContainText('(≈ ¥142,900)')
    await expect(frame).toContainText('700 kr spent (≈ ¥10,000)')
    await expect(frame).toContainText('+500 kr planned (≈ ¥7,100)')
  })
})

test.describe('spending: JPY estimates', () => {
  test('shows an explicit childBudgets.budgetYen without the ≈ prefix', async ({ page, trackDoc, sanity }) => {
    const tripLabel = testName(`Explicit Yen Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      jpyToNokRate: 0.07,
      childBudgets: [{ _key: 'k1', person: 'Niklas', budgetYen: 50000 }],
    })
    trackDoc(trip._id)

    const bought = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Bought Niklas ${Date.now()}`),
      person: 'Niklas',
      status: 'bought',
      priceNok: 100,
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(bought._id)

    await page.goto(`/spending?trip=${trip._id}`)
    const card = page.locator('.person-card[data-person="Niklas"]')
    await expect(card).toBeVisible()
    // Explicit budgetYen=50000 shown exactly, no "≈"
    await expect(card).toContainText('(¥50,000)')
    await expect(card).not.toContainText('≈ ¥50,000')
  })

  test('shows NOK only when the trip has no exchange rate', async ({ page, trackDoc, sanity }) => {
    const tripLabel = testName(`No Rate Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      // jpyToNokRate intentionally omitted
      childBudgets: [{ _key: 'k1', person: 'Kristina', budgetNok: 500 }],
    })
    trackDoc(trip._id)

    const bought = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Bought Kristina ${Date.now()}`),
      person: 'Kristina',
      status: 'bought',
      priceNok: 200,
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(bought._id)

    await page.goto(`/spending?trip=${trip._id}`)
    const card = page.locator('.person-card[data-person="Kristina"]')
    await expect(card).toBeVisible()
    await expect(card).toContainText('200 kr')
    await expect(card).not.toContainText('¥')
  })
})

test.describe('spending: shop/day tax-free', () => {
  test('groups bought purchases by shop/day on the new (refund) system', async ({ page, trackDoc, sanity }) => {
    const tripLabel = testName(`Shop Day Trip ${Date.now()}`)
    const trip = await sanity.create({ _type: 'tripSettings', label: tripLabel, jpyToNokRate: 0.07 })
    trackDoc(trip._id)

    const day = '2026-03-15'

    const taxFreeShop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Tax Free Shop ${Date.now()}`),
      taxFreeShop: true,
    })
    trackDoc(taxFreeShop._id)
    const notTaxFreeShop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Not Tax Free Shop ${Date.now()}`),
      taxFreeShop: false,
    })
    trackDoc(notTaxFreeShop._id)
    const unknownShop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Unknown Status Shop ${Date.now()}`),
    })
    trackDoc(unknownShop._id)
    const underThresholdShop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Under Threshold Shop ${Date.now()}`),
      taxFreeShop: true,
    })
    trackDoc(underThresholdShop._id)

    const reached = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Reached ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 6000, // over the 5500 incl. threshold
      purchaseDate: day,
      store: { _type: 'reference', _ref: taxFreeShop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(reached._id)
    const notTaxFree = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Not Tax Free ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 6000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: notTaxFreeShop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(notTaxFree._id)
    const unknown = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Unknown ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 6000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: unknownShop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(unknown._id)
    const underThreshold = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Under Threshold ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 2000, // under the 5500 incl. threshold -> 3500 missing
      purchaseDate: day,
      store: { _type: 'reference', _ref: underThresholdShop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(underThreshold._id)
    // A planned (not bought) purchase at the tax-free shop/day must NOT count toward
    // the threshold — only actual, bought purchases do.
    const plannedSameDay = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Planned Same Day ${Date.now()}`),
      person: 'Kim',
      status: 'planned',
      priceYen: 10000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: taxFreeShop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(plannedSameDay._id)

    await page.goto(`/spending?trip=${trip._id}`)

    const reachedRow = page.locator('.store-row', { hasText: taxFreeShop.shopName })
    await expect(reachedRow).toBeVisible()
    await expect(reachedRow).toContainText('¥6,000')
    await expect(reachedRow).toContainText('tax-free reached')
    await expect(reachedRow).toContainText('¥545') // 6000 / 11 ≈ 545.45, rounded
    await expect(reachedRow).toHaveClass(/ok/)

    const notTaxFreeRow = page.locator('.store-row', { hasText: notTaxFreeShop.shopName })
    await expect(notTaxFreeRow).toContainText('not a tax-free shop')

    const unknownRow = page.locator('.store-row', { hasText: unknownShop.shopName })
    await expect(unknownRow).toContainText('check if tax-free')
    await expect(unknownRow).toHaveClass(/unknown/)

    const underThresholdRow = page.locator('.store-row', { hasText: underThresholdShop.shopName })
    await expect(underThresholdRow).toContainText('¥3,500 more to reach tax-free')

    const total = page.locator('.store-total')
    await expect(total).toBeVisible()
    await expect(total).toContainText('estimated, before any service fees')
  })

  test('groups by passport holder, not by whose budget the purchase counts against', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Passport Shop Day Trip ${Date.now()}`)
    const trip = await sanity.create({ _type: 'tripSettings', label: tripLabel, jpyToNokRate: 0.07 })
    trackDoc(trip._id)

    const day = '2026-03-16'
    const shop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Passport Row Shop ${Date.now()}`),
      taxFreeShop: true,
    })
    trackDoc(shop._id)

    // Two different buyers, neither sets passportHolder — both default to Kim, so their
    // totals combine into a single row for the threshold, even though they count against
    // different people's budgets.
    const itemKim = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Passport Row Kim ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 3000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(itemKim._id)
    const itemTone = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Passport Row Tone ${Date.now()}`),
      person: 'Tone',
      status: 'bought',
      priceYen: 3000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(itemTone._id)

    await page.goto(`/spending?trip=${trip._id}`)
    const row = page.locator('.store-row', { hasText: shop.shopName })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Kim')
    await expect(row).toContainText('¥6,000')
    await expect(row).toContainText('tax-free reached')
  })
})
