import { test, expect, testName } from './fixtures'

test.describe('checklist: grouping', () => {
  test('does not combine two people\'s purchases at the same shop/day toward the threshold', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Checklist Combine Trip ${Date.now()}`)
    const trip = await sanity.create({ _type: 'tripSettings', label: tripLabel, jpyToNokRate: 0.07 })
    trackDoc(trip._id)

    const day = '2026-03-20'
    const shop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Combine Shop ${Date.now()}`),
      taxFreeShop: true,
    })
    trackDoc(shop._id)

    // Each person is under the 5500-incl. threshold alone; combined they'd be over it.
    // The threshold is checked per individual passport, so neither should qualify.
    const itemA = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Combine Item A ${Date.now()}`),
      person: 'Kim',
      status: 'bought',
      priceYen: 3000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(itemA._id)
    const itemB = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Combine Item B ${Date.now()}`),
      person: 'Tone',
      status: 'bought',
      priceYen: 3000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(itemB._id)

    await page.goto(`/checklist?trip=${trip._id}`)
    await expect(page.locator('.person-section-title', { hasText: 'Kim' })).toHaveCount(0)
    await expect(page.locator('.person-section-title', { hasText: 'Tone' })).toHaveCount(0)
    await expect(page.locator('.shopday-card', { hasText: shop.shopName })).toHaveCount(0)
  })

  test('qualifies a single person\'s shop/day once their own total reaches the threshold', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Checklist Qualify Trip ${Date.now()}`)
    const trip = await sanity.create({ _type: 'tripSettings', label: tripLabel, jpyToNokRate: 0.07 })
    trackDoc(trip._id)

    const day = '2026-03-21'
    const shop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Qualify Shop ${Date.now()}`),
      taxFreeShop: true,
    })
    trackDoc(shop._id)

    const item = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Qualify Item ${Date.now()}`),
      person: 'Richard',
      status: 'bought',
      priceYen: 6000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(item._id)
    // Planned (not bought) items must not count toward the threshold or appear in the list.
    const planned = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Qualify Planned ${Date.now()}`),
      person: 'Richard',
      status: 'planned',
      priceYen: 10000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(planned._id)

    await page.goto(`/checklist?trip=${trip._id}`)
    await expect(page.locator('.person-section-title', { hasText: 'Richard' })).toBeVisible()
    const card = page.locator('.shopday-card', { hasText: shop.shopName })
    await expect(card).toBeVisible()
    await expect(card).toContainText(item.name)
    await expect(card).not.toContainText(planned.name)
    await expect(card).toContainText('¥6,000')
    await expect(card).toContainText('¥545') // estimated refund, 6000 / 11 rounded
  })
})

test.describe('checklist: check the receipt', () => {
  test('lists a qualifying shop/day with unknown tax-free status separately, without checkboxes', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Checklist Unknown Trip ${Date.now()}`)
    const trip = await sanity.create({ _type: 'tripSettings', label: tripLabel, jpyToNokRate: 0.07 })
    trackDoc(trip._id)

    const day = '2026-03-22'
    const unknownShop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Unknown Checklist Shop ${Date.now()}`),
    })
    trackDoc(unknownShop._id)

    const item = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Unknown Shop Item ${Date.now()}`),
      person: 'Niklas',
      status: 'bought',
      priceYen: 6000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: unknownShop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(item._id)

    await page.goto(`/checklist?trip=${trip._id}`)
    await expect(page.locator('.shopday-card', { hasText: unknownShop.shopName })).toHaveCount(0)

    const unknownSection = page.locator('#unknown-wrap')
    await expect(unknownSection).toBeVisible()
    await expect(unknownSection).toContainText('Check the receipt')
    await expect(unknownSection).toContainText(unknownShop.shopName)
    await expect(unknownSection).toContainText('Niklas')
    await expect(unknownSection.locator('input[type="checkbox"]')).toHaveCount(0)
  })
})

test.describe('checklist: persistence', () => {
  test('persists item and receipt checkbox state across reload, and the reset button clears it', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Checklist Persist Trip ${Date.now()}`)
    const trip = await sanity.create({ _type: 'tripSettings', label: tripLabel, jpyToNokRate: 0.07 })
    trackDoc(trip._id)

    const day = '2026-03-23'
    const shop = await sanity.create({
      _type: 'shopNote',
      shopName: testName(`Persist Shop ${Date.now()}`),
      taxFreeShop: true,
    })
    trackDoc(shop._id)

    const item = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`Persist Item ${Date.now()}`),
      person: 'Kristina',
      status: 'bought',
      priceYen: 6000,
      purchaseDate: day,
      store: { _type: 'reference', _ref: shop._id },
      trip: { _type: 'reference', _ref: trip._id },
    })
    trackDoc(item._id)

    await page.goto(`/checklist?trip=${trip._id}`)
    const itemCheckbox = page.locator(`.item-checkbox[data-item-id="${item._id}"]`)
    const receiptCheckbox = page.locator(`.receipt-checkbox[data-group-key="Kristina||${shop.shopName}||${day}"]`)
    const progress = page.locator('#checklist-progress')

    await expect(progress).toHaveText('0 of 1 item ready')
    await itemCheckbox.check()
    await receiptCheckbox.check()
    await expect(progress).toHaveText('1 of 1 item ready')

    await page.reload()
    await expect(page.locator(`.item-checkbox[data-item-id="${item._id}"]`)).toBeChecked()
    await expect(
      page.locator(`.receipt-checkbox[data-group-key="Kristina||${shop.shopName}||${day}"]`)
    ).toBeChecked()
    await expect(page.locator('#checklist-progress')).toHaveText('1 of 1 item ready')

    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('#reset-checklist-btn').click()
    await expect(page.locator(`.item-checkbox[data-item-id="${item._id}"]`)).not.toBeChecked()
    await expect(page.locator('#checklist-progress')).toHaveText('0 of 1 item ready')

    await page.reload()
    await expect(page.locator(`.item-checkbox[data-item-id="${item._id}"]`)).not.toBeChecked()
  })
})
