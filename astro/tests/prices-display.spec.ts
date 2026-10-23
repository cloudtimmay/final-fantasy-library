import { test, expect, testName } from './fixtures'
import { formatPriceNokFirst, cheapestPrice, cheapestLine, toNok } from '../src/lib/price-display'

// Prices are formatted with non-breaking spaces (so they never wrap); compare with plain ones.
const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ')
const RATE = 0.0467 // ~NOK per JPY

test.describe('price display: NOK first, yen alongside', () => {
  test('NOK price gets "≈ ¥X", rounded to ¥100', () => {
    expect(plain(formatPriceNokFirst(649, 'NOK', RATE))).toBe('649 kr (≈ ¥13 900)')
    expect(plain(formatPriceNokFirst(1299.5, 'NOK', RATE))).toBe('1 299.50 kr (≈ ¥27 800)')
  })

  test('JPY price is shown as "≈ X kr (¥Y)"', () => {
    expect(plain(formatPriceNokFirst(5980, 'JPY', RATE))).toBe('≈ 279 kr (¥5 980)')
    expect(plain(formatPriceNokFirst(13900, 'JPY', RATE))).toBe('≈ 649 kr (¥13 900)')
  })

  test('USD/EUR are shown as they are, without conversion', () => {
    expect(plain(formatPriceNokFirst(42.99, 'USD', RATE))).toBe('42.99 USD')
    expect(plain(formatPriceNokFirst(30, 'EUR', RATE))).toBe('30 EUR')
  })

  test('no rate: every price in its own currency only', () => {
    expect(plain(formatPriceNokFirst(649, 'NOK', null))).toBe('649 kr')
    expect(plain(formatPriceNokFirst(5980, 'JPY', undefined))).toBe('¥5 980')
    expect(toNok(5980, 'JPY', null)).toBeNull()
  })

  test('cheapest compares in NOK across currencies', () => {
    const prices = [
      { price: 649, currency: 'NOK', source: 'Outland' },
      { price: 12000, currency: 'JPY', source: 'Mandarake' }, // ≈ 560 kr
      { price: 1, currency: 'USD', source: 'Somewhere' }, // can't be converted: doesn't count
    ]
    expect(cheapestPrice(prices, RATE)?.source).toBe('Mandarake')
    expect(plain(cheapestLine(prices, RATE)?.text)).toBe('≈ 560 kr (¥12 000) · Mandarake')
    expect(cheapestLine(prices, RATE)?.more).toBe(2)
  })

  test('unconvertible prices only count when nothing can be converted', () => {
    expect(cheapestPrice([{ price: 40, currency: 'USD' }, { price: 35, currency: 'USD' }], RATE)?.price).toBe(35)
    // No rate: JPY can't be converted, so the NOK price is the cheapest even though ¥100 is less.
    expect(cheapestPrice([{ price: 100, currency: 'JPY' }, { price: 649, currency: 'NOK' }], null)?.currency).toBe('NOK')
    expect(cheapestLine([], RATE)).toBeNull()
  })
})

// A product with three prices in three currencies, and its own trip (known rate).
async function threeCurrencyProduct(sanity: any, trackDoc: (id: string) => void, rate: number | null) {
  const name = testName(`Price Display ${Date.now()}`)
  const trip = await sanity.create({
    _type: 'tripSettings',
    label: testName(`Price Display Trip ${Date.now()}`),
    ...(rate ? { jpyToNokRate: rate } : {}),
  })
  trackDoc(trip._id)
  const base = { _type: 'priceEntry', productName: name, productNameJp: 'テスト表示', category: 'game', condition: 'new', status: 'considering', seenAt: new Date().toISOString() }
  for (const doc of [
    { ...base, sourceType: 'norway', sourceName: 'Outland', price: 649, currency: 'NOK' },
    { ...base, sourceType: 'japanStore', price: 12000, currency: 'JPY' },
    { ...base, sourceType: 'online', sourceName: 'CDJapan', price: 30, currency: 'USD' },
  ]) {
    const created = await sanity.create(doc)
    trackDoc(created._id)
  }
  return { name, trip }
}

test.describe('/prices: compact rows with the cheapest price up front', () => {
  test('the collapsed row shows the cheapest price (compared in NOK), where it is, and +N', async ({ page, sanity, trackDoc }) => {
    const { name, trip } = await threeCurrencyProduct(sanity, trackDoc, 0.05)
    await page.goto(`/prices?trip=${trip._id}`)

    const row = page.locator('#product-group-view li.price-row', { hasText: name })
    // ¥12 000 × 0.05 = 600 kr, cheaper than 649 kr; the USD price doesn't count.
    await expect(row.locator('.summary-price')).toHaveText('≈ 600 kr (¥12 000) · Shop')
    await expect(row.locator('.summary-more')).toHaveText('+2')
    await expect(row.locator('.cat-icon')).toHaveAttribute('aria-label', 'Game')

    // Expanded: every price in the same NOK-first form (history is newest first, so by source).
    await row.locator('summary').click()
    const priceAt = (source: string) => row.locator('.history-item', { hasText: source }).locator('.history-price')
    await expect(priceAt('Outland')).toHaveText('649 kr (≈ ¥13 000)')
    await expect(priceAt('Shop')).toHaveText('≈ 600 kr (¥12 000)')
    await expect(priceAt('CDJapan')).toHaveText('30 USD')
  })

  test('without an exchange rate, prices stay in their own currency', async ({ page, sanity, trackDoc }) => {
    const { name, trip } = await threeCurrencyProduct(sanity, trackDoc, null)
    await page.goto(`/prices?trip=${trip._id}`)

    const row = page.locator('#product-group-view li.price-row', { hasText: name })
    // Only the NOK price can be compared in NOK, so it's the cheapest.
    await expect(row.locator('.summary-price')).toHaveText('649 kr · Outland')
    await expect(row.locator('.summary-more')).toHaveText('+2')
    await row.locator('summary').click()
    const priceAt = (source: string) => row.locator('.history-item', { hasText: source }).locator('.history-price')
    await expect(priceAt('Outland')).toHaveText('649 kr')
    await expect(priceAt('Shop')).toHaveText('¥12 000')
    await expect(priceAt('CDJapan')).toHaveText('30 USD')
  })

  test('the list shows no Japanese name, no category badge and no "N prices" badge — search still finds the Japanese name', async ({ page, sanity, trackDoc }) => {
    const { name, trip } = await threeCurrencyProduct(sanity, trackDoc, 0.05)
    await page.goto(`/prices?trip=${trip._id}`)

    const row = page.locator('#product-group-view li.price-row', { hasText: name })
    await expect(row.locator('summary')).not.toContainText('テスト表示')
    await expect(row.locator('.summary-jp, .cat-badge, .count-badge, .low-badge')).toHaveCount(0)

    await page.locator('#p-search').fill('テスト表示')
    await expect(row).toBeVisible()
  })
})
