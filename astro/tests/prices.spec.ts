import { test, expect, testName } from './fixtures'

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

    const matchedRow = page.locator('li.price-row', { hasText: matchName })
    const otherRow = page.locator('li.price-row', { hasText: otherName })
    await expect(matchedRow).toBeVisible()
    await expect(otherRow).toBeVisible()

    await page.locator('#p-search').fill(matchName)
    await expect(matchedRow).toBeVisible()
    await expect(otherRow).toBeHidden()

    await matchedRow.locator('summary').click()
    await expect(matchedRow.locator('.history-row').first()).toBeVisible()
    await expect(matchedRow.locator('.history-note').first()).toContainText('fixture note for list test')

    await page.goto(`/prices?open=${encodeURIComponent(matchJan)}`)
    await expect(page.locator(`details[data-key="${matchJan}"]`)).toHaveJSProperty('open', true)
  })
})
