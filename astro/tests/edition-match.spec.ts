import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { editionKeys, editionConflict } from '../src/lib/edition'
import { storeCandidates, rankCandidates, judgeMatch, lookupNorwayStores, checkAiResult, mergeFindPricesResults, algoliaCandidates, type DirectResult } from '../src/lib/store-lookup'
import { extractProductIdentity } from '../src/lib/page-price'

// The real case (October 2026): no ISBN in the form, and Outland's search for the title
// returned the paperback (179 kr) and hardcover (359 kr) as well as the illustrated edition.
const sample = (name: string) => fs.readFileSync(path.join(__dirname, 'html-samples', name), 'utf8')
const SEARCHED = 'Harry Potter and the Half-Blood Prince (Illustrated Edition, illustrated by Levi Pinfold)'
const ILLUSTRATED = 'https://www.outland.no/p/p-harry-potter-and-the-half-blood-prince-9781408845691'
const PAPERBACK = 'https://www.outland.no/p/half-blood-prince'
const HARDCOVER = 'https://www.outland.no/p/half-blood-prince-hc'

test.describe('edition keywords', () => {
  test('found in English, Norwegian and Japanese, as whole words', () => {
    expect([...editionKeys(SEARCHED)]).toEqual(['illustrated'])
    expect([...editionKeys('Harry Potter og Halvblodsprinsen (innbundet)')]).toEqual(['hardcover'])
    expect([...editionKeys('ファイナルファンタジーXVI 限定版 スチールブック')].sort()).toEqual(['limited', 'steelbook'])
    expect([...editionKeys("Final Fantasy VII Collector's Edition Vinyl LP")].sort()).toEqual(['collectors', 'vinyl'])
    expect(editionKeys('Pokémon Pocket Monsters Shelf').size).toBe(0) // "pocket" is not paperback
    expect(editionKeys('Chocolate Frog').size).toBe(0)
  })

  test('a missing or extra edition is another edition; formats conflict only when stated', () => {
    expect(editionConflict(SEARCHED, 'Harry Potter and the Half-Blood Prince')).toBe('not the illustrated edition')
    expect(editionConflict(SEARCHED, 'Harry Potter and the Half-Blood Prince: Illustrated Edition')).toBeNull()
    expect(editionConflict(SEARCHED, 'Harry Potter and the Half-Blood Prince: Deluxe Illustrated Slipcase Edition')).toBe('a deluxe edition')
    expect(editionConflict('Final Fantasy VII OST (Vinyl)', 'Final Fantasy VII Original Soundtrack CD')).toBe('CD, not vinyl')
    expect(editionConflict('Some Book (Hardcover)', 'Some Book Paperback')).toBe('paperback, not hardcover')
    expect(editionConflict('Some Book (Hardcover)', 'Some Book')).toBeNull() // format not stated -> kept
    expect(editionConflict('Harry Potter and the Half-Blood Prince', 'Harry Potter and the Half-Blood Prince: Illustrated Edition')).toBeNull() // no edition searched
  })
})

test.describe('edition-aware store lookup: the three Outland cases', () => {
  test('ranking the real Outland search page keeps only the illustrated edition', () => {
    const c = storeCandidates('Outland', sample('outland-search-hbp.html'), 'https://www.outland.no/search/x')!
    expect(c.length).toBe(8)
    // Paperback, hardcover, adult-cover hardcover, deluxe slipcase, puzzle, stenciled edges: all gone.
    expect(rankCandidates(c, { productName: SEARCHED }).map((x) => x.url)).toEqual([ILLUSTRATED])
  })

  test('the product pages: illustrated matches by name, paperback and hardcover do not', () => {
    const product = { productName: SEARCHED }
    expect(judgeMatch(extractProductIdentity(sample('outland-hbp-illustrated.html')), product)).toBe('name')
    expect(judgeMatch(extractProductIdentity(sample('outland-hbp-paperback.html')), product)).toBeNull()
    expect(judgeMatch(extractProductIdentity(sample('outland-hbp-hardcover.html')), product)).toBeNull()
  })

  test('full lookup without an ISBN: only the illustrated edition (579 kr), as a name-only match', async () => {
    const pages: Record<string, string> = {
      'https://www.outland.no/search/Harry%20Potter%20and%20the%20Half-Blood%20Prince': sample('outland-search-hbp.html'),
      [ILLUSTRATED]: sample('outland-hbp-illustrated.html'),
      [PAPERBACK]: sample('outland-hbp-paperback.html'),
      [HARDCOVER]: sample('outland-hbp-hardcover.html'),
    }
    const result = await lookupNorwayStores('book', { productName: SEARCHED }, {
      deadline: Date.now() + 30000,
      fetchPage: async (url) => (pages[url] ? { ok: true, html: pages[url] } : { ok: false, reason: 'blocked (HTTP 403)' }),
    })
    expect(result.results).toEqual([expect.objectContaining({ store: 'Outland', price: 579, url: ILLUSTRATED, matchedBy: 'name', verified: true })])
  })

  test('a sure code match at a store drops that store\'s name-only matches', async () => {
    const product = (name: string, gtin?: string) =>
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, ...(gtin ? { gtin13: gtin } : {}), offers: { price: 599, priceCurrency: 'NOK' } })}</script>`
    const search = `<div preloadedSearchResult='${JSON.stringify({ products: [
      { name: 'Final Fantasy Resonance', url: '/product/1/a' },
      { name: 'Final Fantasy Resonance', url: '/product/2/b' },
    ] })}'></div>`
    const pages: Record<string, string> = {
      'https://www.komplett.no/search?q=5021290102958': search,
      'https://www.komplett.no/product/1/a': product('Final Fantasy Resonance (PS5)', '5021290102958'),
      'https://www.komplett.no/product/2/b': product('Final Fantasy Resonance (Switch 2)'), // no code on the page
    }
    const result = await lookupNorwayStores('game', { productName: 'Final Fantasy Resonance', jan: '5021290102958' }, {
      deadline: Date.now() + 30000,
      fetchPage: async (url) => (pages[url] ? { ok: true, html: pages[url] } : { ok: false, reason: 'blocked (HTTP 403)' }),
    })
    expect(result.results.map((r) => [r.url, r.matchedBy])).toEqual([['https://www.komplett.no/product/1/a', 'code']])
  })
})

test.describe('edition-aware store lookup: Norli (edition in the search data, not the name)', () => {
  test('without an ISBN, Norli\'s illustrated hit is kept by its sub_title; pocket and plain hardcover are dropped', () => {
    const data = JSON.parse(sample('norli-algolia.json'))
    data.results[0].hits = [] // as if no ISBN query matched: use the name query's hits
    const c = algoliaCandidates(JSON.stringify(data))!
    expect(c.map((x) => x.edition)).toEqual(['Illustrated Edition Innbundet', 'pocketbok', 'pocketbok', 'Innbundet'])
    expect(rankCandidates(c, { productName: SEARCHED }).map((x) => x.code)).toEqual(['9781408845691'])
  })

  test('a Norwegian "Pocket" format conflicts with a hardcover search', () => {
    expect(editionConflict('Harry Potter and the Half-Blood Prince (Hardcover)', 'Harry Potter and the Half-Blood Prince pocketbok')).toBe('paperback, not hardcover')
  })
})

test.describe('edition check on AI results', () => {
  test('a paperback or hardcover page is dropped with a reason; the illustrated one is a name match', () => {
    const product = { productName: SEARCHED }
    expect(checkAiResult(extractProductIdentity(sample('outland-hbp-paperback.html')), product)).toEqual({ drop: 'another edition (not the illustrated edition)' })
    expect(checkAiResult(extractProductIdentity(sample('outland-hbp-illustrated.html')), product)).toEqual({ matchedBy: 'name' })
    expect(checkAiResult(null, product)).toEqual({})
  })

  test('with an ISBN: same ISBN is a code match, another ISBN is another edition', () => {
    const product = { productName: SEARCHED, jan: '9781408845691' }
    expect(checkAiResult(extractProductIdentity(sample('outland-hbp-illustrated.html')), product)).toEqual({ matchedBy: 'code' })
    expect(checkAiResult(extractProductIdentity(sample('outland-hbp-hardcover.html')), product)).toEqual({ drop: 'another edition (different EAN/ISBN)' })
  })

  test('merge: code matches first, unknown next, name-only last; a store with a code match loses its name-only ones', () => {
    const direct = (url: string, matchedBy: 'code' | 'name'): DirectResult => ({ store: 'S', price: 1, currency: 'NOK', url, inStock: null, verified: true, matchedBy, direct: true })
    const merged = mergeFindPricesResults(
      [
        { url: 'https://www.proshop.no/a', matchedBy: 'name' as const },
        { url: 'https://www.komplett.no/b' },
        { url: 'https://www.outland.no/p/other', matchedBy: 'name' as const },
        { url: 'https://cdon.no/c', matchedBy: 'code' as const },
      ],
      [direct('https://www.outland.no/p/sure', 'code'), direct('https://www.power.no/p/x', 'name')]
    )
    expect(merged.map((r) => r.url)).toEqual([
      'https://www.outland.no/p/sure',
      'https://cdon.no/c',
      'https://www.komplett.no/b',
      'https://www.power.no/p/x',
      'https://www.proshop.no/a',
    ])
  })
})

test.describe('add-price: name-only matches are labelled', () => {
  test('"Name match only, check the edition" on name matches, not on code matches', async ({ page }) => {
    await page.route('**/api/find-prices', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [
            { store: 'Norli', price: 529, currency: 'NOK', url: 'https://www.norli.no/boker/test-fixture', inStock: true, verified: 'store-search', matchedBy: 'code', direct: true },
            { store: 'Outland', price: 579, currency: 'NOK', url: 'https://www.outland.no/p/test-fixture', inStock: null, verified: true, matchedBy: 'name', direct: true },
          ],
          diagnostics: { searches: 6, candidates: 0, dropped: [] },
        }),
      })
    )
    await page.goto('/add-price')
    await page.locator('#p-name').fill(testName(SEARCHED))
    await page.locator('#p-category').selectOption('book')
    await page.locator('input[name="p-source"][value="norway"]').check()
    await page.locator('#p-find-prices-btn').click()

    const items = page.locator('.ap-find-prices-item')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0).locator('.ap-find-prices-edition-warning')).toHaveCount(0)
    await expect(items.nth(0).locator('.ap-find-prices-meta')).toContainText('Same barcode/ISBN')
    await expect(items.nth(1).locator('.ap-find-prices-edition-warning')).toHaveText('Name match only, check the edition')
  })
})
