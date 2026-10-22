import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { extractPagePrice, applyPagePrice } from '../src/lib/page-price'

const CURRENCIES = ['JPY', 'NOK', 'USD', 'EUR']
const sample = (name: string) => fs.readFileSync(path.join(__dirname, 'html-samples', name), 'utf8')
const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

test.describe('extractPagePrice: structured data on a product page', () => {
  test('real Outland page: JSON-LD AggregateOffer lowPrice 279 NOK (search had said 349)', () => {
    expect(extractPagePrice(sample('outland-flareon.html'))).toEqual({ price: 279, currency: 'NOK', availability: null, source: 'json-ld' })
  })

  test('JSON-LD Offer inside @graph, with a string price and availability', () => {
    const html = page(
      ld({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: 'x' },
          { '@type': 'Product', name: 'Test', offers: [{ '@type': 'Offer', price: '1299.00', priceCurrency: 'nok', availability: 'https://schema.org/InStock' }] },
        ],
      })
    )
    expect(extractPagePrice(html)).toEqual({ price: 1299, currency: 'NOK', availability: 'InStock', source: 'json-ld' })
  })

  test('JSON-LD discount: the offer price wins over a list price in priceSpecification', () => {
    const html = page(
      ld({
        '@type': 'Product',
        offers: {
          '@type': 'Offer',
          price: 279,
          priceCurrency: 'NOK',
          availability: 'PreOrder',
          priceSpecification: [{ '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/ListPrice', price: 349, priceCurrency: 'NOK' }],
        },
      })
    )
    expect(extractPagePrice(html)).toMatchObject({ price: 279, currency: 'NOK', availability: 'PreOrder' })
  })

  test('meta tags only (og:price), with availability', () => {
    const html = page(
      '<meta property="og:price:amount" content="42.99"><meta property="og:price:currency" content="USD"><meta property="og:availability" content="out of stock">'
    )
    expect(extractPagePrice(html)).toEqual({ price: 42.99, currency: 'USD', availability: 'OutOfStock', source: 'meta' })
  })

  test('meta discount: sale_price wins over the regular price', () => {
    const html = page(
      '<meta content="349" property="product:price:amount"><meta property="product:sale_price:amount" content="279,00"><meta property="product:price:currency" content="NOK">'
    )
    expect(extractPagePrice(html)).toMatchObject({ price: 279, currency: 'NOK', source: 'meta' })
  })

  test('microdata, with a Norwegian-formatted price in the element text', () => {
    const html = page(
      '',
      '<div itemscope itemtype="https://schema.org/Offer"><span itemprop="price">1 299,00</span><meta itemprop="priceCurrency" content="NOK"><link itemprop="availability" href="https://schema.org/BackOrder"></div>'
    )
    expect(extractPagePrice(html)).toEqual({ price: 1299, currency: 'NOK', availability: 'BackOrder', source: 'microdata' })
  })

  test('JSON-LD comes before meta tags when both have a price', () => {
    const html = page('<meta property="product:price:amount" content="349">' + ld({ '@type': 'Product', offers: { price: 279, priceCurrency: 'NOK' } }))
    expect(extractPagePrice(html)).toMatchObject({ price: 279, source: 'json-ld' })
  })

  test('a page without price data (or with broken JSON-LD) gives null', () => {
    expect(extractPagePrice(page('<title>Hi</title><meta property="og:title" content="Flareon">', '<span class="integer">279</span>'))).toBeNull()
    expect(extractPagePrice(page('<script type="application/ld+json">{not json</script>'))).toBeNull()
    expect(extractPagePrice(page(ld({ '@type': 'BreadcrumbList', itemListElement: [] })))).toBeNull()
  })
})

test.describe('applyPagePrice: merging the page price into a search result', () => {
  const result = { store: 'Outland', price: 349, currency: 'NOK', url: 'https://www.outland.no/p/x', inStock: true as boolean | null }

  test('a different page price replaces the search price, which is kept as searchPrice', () => {
    expect(applyPagePrice(result, { price: 279, currency: 'NOK', availability: null, source: 'json-ld' }, 'norway', CURRENCIES)).toMatchObject({
      price: 279, currency: 'NOK', verified: true, searchPrice: 349, searchCurrency: 'NOK', inStock: true,
    })
  })

  test('the same price: verified, no searchPrice', () => {
    const r = applyPagePrice(result, { price: 349, currency: 'NOK', availability: null, source: 'meta' }, 'norway', CURRENCIES)
    expect(r.verified).toBe(true)
    expect(r.searchPrice).toBeUndefined()
  })

  test('no page price (blocked, timeout, no structured data): the model price, unverified', () => {
    expect(applyPagePrice(result, null, 'norway', CURRENCIES)).toEqual({ ...result, verified: false })
  })

  test('structured availability replaces the model guess', () => {
    expect(applyPagePrice(result, { price: 279, currency: 'NOK', availability: 'OutOfStock', source: 'json-ld' }, 'norway', CURRENCIES)).toMatchObject({ inStock: false, availability: 'OutOfStock' })
    expect(applyPagePrice(result, { price: 279, currency: 'NOK', availability: 'PreOrder', source: 'json-ld' }, 'norway', CURRENCIES)).toMatchObject({ inStock: null, availability: 'PreOrder' })
  })

  test('a non-NOK page price on a Norway search is not used', () => {
    expect(applyPagePrice(result, { price: 30, currency: 'EUR', availability: null, source: 'meta' }, 'norway', CURRENCIES)).toMatchObject({ price: 349, currency: 'NOK', verified: false })
  })

  test('online: a page in a different currency replaces a geo-converted search price', () => {
    const online = { ...result, price: 42.99, currency: 'USD' }
    expect(applyPagePrice(online, { price: 5980, currency: 'JPY', availability: null, source: 'json-ld' }, 'online', CURRENCIES)).toMatchObject({
      price: 5980, currency: 'JPY', verified: true, searchPrice: 42.99, searchCurrency: 'USD',
    })
  })
})

async function findWith(pageObj: import('@playwright/test').Page, results: Record<string, unknown>[]) {
  await pageObj.route('**/api/find-prices', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results, diagnostics: { searches: 6, candidates: results.length, dropped: [] } }) })
  )
  await pageObj.goto('/add-price')
  await pageObj.locator('#p-name').fill(testName('Flareon Plush Figure 20 cm'))
  await pageObj.locator('#p-category').selectOption('figure')
  await pageObj.locator('input[name="p-source"][value="norway"]').check()
  await pageObj.locator('#p-find-prices-btn').click()
}

test.describe('add-price: Find prices shows whether each price was checked on the page', () => {
  test('verified and different: "279 kr (search said 349 kr)", and Save this price saves 279', async ({ page }) => {
    let saved: any = null
    await page.route('**/api/price-entry', async (route) => {
      saved = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'test-not-created' }) })
    })
    await findWith(page, [
      { store: 'Outland', price: 279, currency: 'NOK', url: 'https://www.outland.no/p/test-fixture', inStock: true, verified: true, searchPrice: 349, searchCurrency: 'NOK' },
    ])

    const item = page.locator('.ap-find-prices-item')
    await expect(item.locator('.ap-find-prices-price')).toHaveText('279 NOK')
    await expect(item.locator('.ap-find-prices-check')).toHaveText('✓ Price checked on page: 279 kr (search said 349 kr)')

    await item.locator('.ap-find-prices-log-btn').click()
    await expect(item.locator('.ap-find-prices-log-btn')).toHaveText('Saved ✓')
    expect(saved).toMatchObject({ price: 279, currency: 'NOK', sourceName: 'Outland' })
  })

  test('verified and the same: "✓ Price checked on page"', async ({ page }) => {
    await findWith(page, [{ store: 'Outland', price: 279, currency: 'NOK', url: 'https://www.outland.no/p/test-fixture', inStock: null, verified: true, availability: 'PreOrder' }])

    const item = page.locator('.ap-find-prices-item')
    await expect(item.locator('.ap-find-prices-check')).toHaveText('✓ Price checked on page')
    await expect(item.locator('.ap-find-prices-meta')).toContainText('Pre-order')
  })

  test('not verified: "Unverified (from search)"', async ({ page }) => {
    await findWith(page, [{ store: 'Komplett', price: 349, currency: 'NOK', url: 'https://www.komplett.no/product/test-fixture', inStock: true, verified: false }])

    const item = page.locator('.ap-find-prices-item')
    await expect(item.locator('.ap-find-prices-price')).toHaveText('349 NOK')
    await expect(item.locator('.ap-find-prices-check')).toHaveText('Unverified (from search)')
  })
})
