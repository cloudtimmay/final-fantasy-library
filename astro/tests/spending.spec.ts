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
