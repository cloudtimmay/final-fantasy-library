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
    // bought 700 / budget 900
    await expect(card).toContainText('700 kr / 900 kr')
    // planned: 300 (familyPurchase) + 100 (priceEntry, no barcode match) = 400
    await expect(card).toContainText('+400 kr planned')
    // remaining = budget(900) - bought(700) = 200
    await expect(card).toContainText('200 kr left')
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
    await expect(frame).toContainText('700 kr spent')
    await expect(frame).toContainText('+500 kr planned')
  })
})
