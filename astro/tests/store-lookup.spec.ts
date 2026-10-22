import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName } from './fixtures'
import {
  storeSearchUrl,
  storeCandidates,
  genericCandidates,
  rankCandidates,
  judgeMatch,
  lookupNorwayStores,
  mergeFindPricesResults,
  algoliaCandidates,
  ALGOLIA_STORES,
  type FetchHtml,
  type DirectResult,
} from '../src/lib/store-lookup'
import { extractProductIdentity } from '../src/lib/page-price'
import { describeFindPricesDiagnostics } from '../src/lib/find-prices-results'

// Real pages saved (trimmed) in October 2026 — see each file's header comment.
const sample = (name: string) => fs.readFileSync(path.join(__dirname, 'html-samples', name), 'utf8')
const HP_ILLUSTRATED = { productName: 'Harry Potter and the Half-Blood Prince (illustrated by Levi Pinfold)', jan: '9781408845691' }

test.describe('store lookup: search URLs and search-page parsing', () => {
  test('search URLs: Outland puts the query in the path, the others use their search URL', () => {
    expect(storeSearchUrl('Outland', 'Beast Ball')).toBe('https://www.outland.no/search/Beast%20Ball')
    expect(storeSearchUrl('Komplett', '5021290104167')).toBe('https://www.komplett.no/search?q=5021290104167')
    expect(storeSearchUrl('Tanum', '9788202523299')).toBe('https://www.cappelendamm.no/search?query=9788202523299')
    expect(storeSearchUrl('Adlibris', 'x')).toBeNull()
  })

  test('Outland: product links, names and SKUs from the embedded search data', () => {
    const c = storeCandidates('Outland', sample('outland-search-name.html'), 'https://www.outland.no/search/x')!
    expect(c.length).toBe(6)
    expect(c[0]).toEqual({ url: 'https://www.outland.no/p/half-blood-prince', name: 'Harry Potter and the Half-Blood Prince', code: '9781408855706' })
  })

  test('Outland: a broad but real result (15 961 hits) is accepted', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { products: { total_count: 15961, items: [{ name: 'Final Fantasy Starter Kit', url_key: 'ff-starter', sku: 'x' }] } } } })}</script>`
    expect(storeCandidates('Outland', html, 'https://www.outland.no/search/x')).toHaveLength(1)
  })

  test('Outland: the unfiltered default listing (query not applied) is not taken as results', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { products: { total_count: 82081, items: [{ name: 'PRO-Fit', url_key: 'pro-fit', sku: '74427827120' }] } } } })}</script>`
    expect(storeCandidates('Outland', html, 'https://www.outland.no/search?q=x')).toBeNull()
  })

  test('Komplett: product links and names from preloadedSearchResult', () => {
    const c = storeCandidates('Komplett', sample('komplett-search.html'), 'https://www.komplett.no/search?q=x')!
    expect(c.length).toBe(5)
    expect(c[0].url).toBe('https://www.komplett.no/product/1344609/gaming/spill/spill-til-nintendo-switch-2/final-fantasy-vii-revelation-magic-edition-switch-2')
    expect(c[0].name).toBe('Final Fantasy VII Revelation Magic Edition Switch 2')
  })

  test('Cappelen Damm: book links, with the ISBN taken from the URL', () => {
    const c = storeCandidates('Tanum', sample('cappelendamm-search.html'), 'https://www.cappelendamm.no/search?query=x')!
    expect(c[0]).toEqual({ url: 'https://www.cappelendamm.no/boker/harry-potter-og-halvblodsprinsen-jk-rowling-the-blair-partnership-9788202523299', code: '9788202523299' })
  })

  test('generic fallback: same-host links that look like product pages', () => {
    const html = '<a href="/p/beast-ball-123">x</a><a href="https://other.no/p/y">x</a><a href="/kundeservice">x</a><a href="/produkt/abc?ref=1">x</a>'
    expect(genericCandidates(html, 'https://www.store.no/sok?q=x')).toEqual([{ url: 'https://www.store.no/p/beast-ball-123' }, { url: 'https://www.store.no/produkt/abc' }])
  })

  test('a page rendered only in the browser is "layout not recognized" (null)', () => {
    expect(storeCandidates('Norli', '<html><body><div id="root"></div><script src="/app.js"></script></body></html>', 'https://www.norli.no/search?query=x')).toBeNull()
  })
})

test.describe('store lookup: ranking and matching', () => {
  test('ISBN search at Outland: other illustrated editions (different ISBN) are dropped', () => {
    const c = storeCandidates('Outland', sample('outland-search-isbn.html'), 'https://www.outland.no/search/9781408845691')!
    expect(c.length).toBe(11)
    expect(rankCandidates(c, HP_ILLUSTRATED)).toEqual([])
  })

  test('the same code ranks first, a weak or missing name match is dropped, at most 3', () => {
    const ranked = rankCandidates(
      [
        { url: 'https://s.no/p/a', name: 'Final Fantasy XVI' }, // only a fragment of the searched name
        { url: 'https://s.no/p/b', name: 'The Art of Final Fantasy XVI', code: '9781646092369' },
        { url: 'https://s.no/p/c', name: 'Art of Final Fantasy XVI: Deluxe' },
        { url: 'https://s.no/p/d' },
        { url: 'https://s.no/p/e' },
        { url: 'https://s.no/p/f', name: 'Something else' },
      ],
      { productName: 'Art of Final Fantasy XVI', jan: '1-64609-236-8' }
    )
    expect(ranked.map((c) => c.url)).toEqual(['https://s.no/p/b', 'https://s.no/p/c', 'https://s.no/p/d'])
  })

  test('judgeMatch on real product pages: same ISBN is sure, a different ISBN is not a match', () => {
    const outland = extractProductIdentity(sample('outland-product.html')) // Goblet of Fire, 9781408845677
    expect(judgeMatch(outland, { productName: 'Harry Potter and the Goblet of Fire', jan: '9781408845677' })).toBe('code')
    expect(judgeMatch(outland, HP_ILLUSTRATED)).toBeNull()

    const cd = extractProductIdentity(sample('cappelendamm-product.html'))
    expect(judgeMatch(cd, { productName: 'whatever', jan: '978-82-02-52329-9' })).toBe('code')
  })

  test('judgeMatch by name when the product has no code: strong match only', () => {
    const komplett = extractProductIdentity(sample('komplett-product.html'))
    expect(komplett.gtin).toBe('5021290104167')
    expect(judgeMatch(komplett, { productName: 'Final Fantasy VII Revelation Magic Edition' })).toBe('name')
    expect(judgeMatch(komplett, { productName: 'Final Fantasy VII Rebirth' })).toBeNull()
    expect(judgeMatch(extractProductIdentity(sample('outland-flareon.html')), { productName: 'Flareon Plush Figure 20 cm (Pokemon)' })).toBe('name')
  })
})

// A fake fetch: url -> html, or a failure reason; anything unlisted is "blocked".
function fakeFetch(pages: Record<string, string | { reason: string }>): FetchHtml {
  return async (url) => {
    const page = pages[url]
    if (page === undefined) return { ok: false, reason: 'blocked (HTTP 403)' }
    return typeof page === 'string' ? { ok: true, html: page } : { ok: false, reason: page.reason }
  }
}

test.describe('store lookup: all stores in parallel', () => {
  test('a sure ISBN match at Cappelen Damm; blocked and unrecognized stores are reported, not fatal', async () => {
    const result = await lookupNorwayStores(
      'book',
      { productName: 'Harry Potter og Halvblodsprinsen', jan: '9788202523299' },
      {
        deadline: Date.now() + 30000,
        fetchPage: fakeFetch({
          'https://www.cappelendamm.no/search?query=9788202523299': sample('cappelendamm-search.html'),
          'https://www.cappelendamm.no/boker/harry-potter-og-halvblodsprinsen-jk-rowling-the-blair-partnership-9788202523299': sample('cappelendamm-product.html'),
          'https://www.outland.no/search/9788202523299': sample('outland-search-isbn.html'),
          'https://www.outland.no/search/Harry%20Potter%20og%20Halvblodsprinsen': sample('outland-search-name.html'),
          'https://www.ark.no/sok?text=9788202523299': { reason: 'blocked (HTTP 429)' },
          'https://www.norli.no/search?query=9788202523299': '<html><div id="root"></div></html>',
          'https://www.komplett.no/search?q=9788202523299': { reason: 'timed out' },
        }),
      }
    )
    expect(result.results).toEqual([
      expect.objectContaining({ store: 'Tanum (Cappelen Damm)', price: 329, currency: 'NOK', availability: 'BackOrder', inStock: null, verified: true, matchedBy: 'code', direct: true }),
    ])
    const byStore = Object.fromEntries(result.stores.map((s) => [s.store, s]))
    expect(byStore['Tanum (Cappelen Damm)']).toEqual({ store: 'Tanum (Cappelen Damm)', found: 1 })
    expect(byStore['Outland']).toEqual({ store: 'Outland', found: 0 }) // only other editions there
    expect(byStore['Ark'].reason).toBe('blocked (HTTP 429)')
    expect(byStore['Norli'].reason).toBe('search key: blocked (HTTP 403)') // its key request isn't in this fake
    expect(byStore['Komplett'].reason).toBe('timed out')
    expect(result.stores.map((s) => s.store)).not.toContain('Adlibris') // no search URL
  })

  test('past the deadline nothing is fetched', async () => {
    let calls = 0
    const result = await lookupNorwayStores('figure', { productName: 'Beast Ball' }, {
      deadline: Date.now() - 1,
      fetchPage: async () => { calls++; return { ok: false, reason: 'x' } },
    })
    expect(calls).toBe(0)
    expect(result.results).toEqual([])
    expect(result.stores.every((s) => s.reason === 'out of time')).toBe(true)
  })
})

test.describe('store lookup: Power (JSON search API)', () => {
  const POWER_API = (q: string) => `https://www.power.no/api/v2/productlists?size=36&q=${encodeURIComponent(q)}&s=5&from=0&o=false&cd=false`
  const INTERGRADE_URL = 'https://www.power.no/gaming/nintendo/nintendo-spill/final-fantasy-vii-remake-intergrade-nintendo-switch/p-4198158/'

  test('search URL is the API request power.no makes itself', () => {
    expect(storeSearchUrl('Power', 'Final Fantasy VII')).toBe(POWER_API('Final Fantasy VII'))
  })

  test('product links and titles from the API response; not JSON -> layout not recognized', () => {
    const c = storeCandidates('Power', sample('power-search.json'), POWER_API('x'))!
    expect(c.length).toBe(5)
    expect(c[0]).toEqual({ url: INTERGRADE_URL, name: 'Final Fantasy VII Remake Intergrade (Nintendo Switch)', code: null })
    expect(storeCandidates('Power', '<html>blocked</html>', POWER_API('x'))).toBeNull()
  })

  test('the product page gives price, availability and the GTIN', () => {
    const html = sample('power-product.html')
    expect(extractProductIdentity(html)).toMatchObject({ name: 'Final Fantasy VII Remake Intergrade (Nintendo Switch)', gtin: '5021290101722' })
    expect(judgeMatch(extractProductIdentity(html), { productName: 'x', jan: '5021290101722' })).toBe('code')
  })

  test('one search request per search, by name even when an EAN is given; a sure match by the page GTIN', async () => {
    const requested: string[] = []
    const pages: Record<string, string> = {
      [POWER_API('Final Fantasy VII Remake Intergrade')]: sample('power-search.json'),
      [INTERGRADE_URL]: sample('power-product.html'),
    }
    const result = await lookupNorwayStores(
      'game',
      { productName: 'Final Fantasy VII Remake Intergrade (Nintendo Switch)', jan: '5021290101722' },
      {
        deadline: Date.now() + 30000,
        fetchPage: async (url) => {
          requested.push(url)
          return pages[url] ? { ok: true, html: pages[url] } : { ok: false, reason: 'blocked (HTTP 403)' }
        },
      }
    )
    expect(requested.filter((u) => u.startsWith('https://www.power.no/api/'))).toEqual([POWER_API('Final Fantasy VII Remake Intergrade')])
    expect(result.results).toEqual([
      expect.objectContaining({ store: 'Power', price: 449, currency: 'NOK', availability: 'InStock', inStock: true, matchedBy: 'code', url: INTERGRADE_URL }),
    ])
  })
})

test.describe('store lookup: Algolia stores (Platekompaniet, Norli) — price from the store search', () => {
  const PLATE_ALGOLIA = 'https://h4zqsn0rmc-dsn.algolia.net/1/indexes/*/queries'
  const NORLI_ALGOLIA = 'https://aeeyieersj-dsn.algolia.net/1/indexes/*/queries'
  const PLATE_URL = 'https://www.platekompaniet.no/gaming/playstation/spill/rpg-rollespill/final-fantasy-resonance-spill-playstation-5'
  const NORLI_URL = 'https://www.norli.no/boker/skjonnlitteratur/romaner/engelske-romaner/harry-potter-and-the-half-blood-prince-9781408845691'
  const SHELL = '<!doctype html><html><head><title>Norli</title></head><body><div id="root"></div></body></html>'

  test('key and index live in one place', () => {
    expect(ALGOLIA_STORES.Platekompaniet).toMatchObject({ appId: 'H4ZQSN0RMC', index: 'plate_prod_default_products' })
    expect(ALGOLIA_STORES.Platekompaniet.apiKey).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(ALGOLIA_STORES.Norli).toMatchObject({ appId: 'AEEYIEERSJ', index: 'norli_pwa_products', keyUrl: 'https://www.norli.no/graphql' })
  })

  test('Platekompaniet hits: EAN (a JSON number), price and stock; the internal sku is not a code', () => {
    const c = algoliaCandidates(sample('platekompaniet-algolia.json'))!
    expect(c[0]).toMatchObject({ url: PLATE_URL, name: 'Final Fantasy RESONANCE', code: '5021290102958', price: 699, inStock: true })
    expect(c[0].edition).toContain('PS5')
  })

  test('Norli hits: the Half-Blood Prince (illustrated) is ISBN 9781408845691 at 529 NOK, URL on www', () => {
    const c = algoliaCandidates(sample('norli-algolia.json'), (u) => u.replace('https://checkout.norli.no/', 'https://www.norli.no/'))!
    expect(c).toHaveLength(1)
    expect(c[0]).toEqual({ url: NORLI_URL, name: 'Harry Potter and the Half-Blood Prince', code: '9781408845691', price: 529, inStock: true, edition: 'Illustrated Edition Innbundet' })
  })

  test('the name query is used when the code query finds nothing; other editions are then dropped by ISBN', () => {
    const data = JSON.parse(sample('norli-algolia.json'))
    data.results[0].hits = []
    const c = algoliaCandidates(JSON.stringify(data))!
    expect(c.length).toBeGreaterThan(1)
    expect(rankCandidates(c, { productName: 'Harry Potter and the Half-Blood Prince', jan: '9781408845691' }).map((x) => x.code)).toEqual(['9781408845691'])
    expect(algoliaCandidates('<html>blocked</html>')).toBeNull()
  })

  test('Norli: key via GraphQL, then ONE Algolia request with both queries; no page price -> store-search', async () => {
    const calls: { url: string; init?: any }[] = []
    const fetchPage: FetchHtml = async (url, _ms, init) => {
      calls.push({ url, init })
      if (url === 'https://www.norli.no/graphql') return { ok: true, html: JSON.stringify({ data: { createAlgoliaKey: 'TEST-KEY' } }) }
      if (url === NORLI_ALGOLIA) return { ok: true, html: sample('norli-algolia.json') }
      if (url === NORLI_URL) return { ok: true, html: SHELL }
      return { ok: false, reason: 'blocked (HTTP 403)' }
    }
    const result = await lookupNorwayStores('book', HP_ILLUSTRATED, { deadline: Date.now() + 30000, fetchPage })

    const key = calls.find((c) => c.url === 'https://www.norli.no/graphql')!
    expect(key.init.method).toBe('POST')
    expect(JSON.parse(key.init.body).operationName).toBe('createAlgoliaKey')
    const algolia = calls.filter((c) => c.url === NORLI_ALGOLIA)
    expect(algolia).toHaveLength(1)
    expect(algolia[0].init.headers['X-Algolia-API-Key']).toBe('TEST-KEY')
    expect(JSON.parse(algolia[0].init.body).requests.map((r: any) => r.params)).toEqual([
      'hitsPerPage=10&query=9781408845691',
      `hitsPerPage=10&query=${encodeURIComponent('Harry Potter and the Half-Blood Prince')}`,
    ])
    expect(result.results).toEqual([
      { store: 'Norli', price: 529, currency: 'NOK', url: NORLI_URL, inStock: true, verified: 'store-search', matchedBy: 'code', direct: true },
    ])
  })

  test('Norli: a failed key request skips Norli with the reason', async () => {
    const result = await lookupNorwayStores('book', HP_ILLUSTRATED, {
      deadline: Date.now() + 30000,
      fetchPage: async (url) => (url === 'https://www.norli.no/graphql' ? { ok: false, reason: 'timed out' } : { ok: false, reason: 'blocked (HTTP 403)' }),
    })
    expect(result.stores.find((s) => s.store === 'Norli')).toEqual({ store: 'Norli', found: 0, reason: 'search key: timed out' })
    expect(result.results).toEqual([])
  })

  test('Platekompaniet: one Algolia request with the public key; a price on the product page wins', async () => {
    const pageWithPrice = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Final Fantasy RESONANCE', gtin13: '5021290102958', offers: { price: 649, priceCurrency: 'NOK', availability: 'InStock' } })}</script>`
    const calls: { url: string; init?: any }[] = []
    const run = (productPage: string) =>
      lookupNorwayStores('album', { productName: 'Final Fantasy Resonance', jan: '5021290102958' }, {
        deadline: Date.now() + 30000,
        fetchPage: async (url, _ms, init) => {
          calls.push({ url, init })
          if (url === PLATE_ALGOLIA) return { ok: true, html: sample('platekompaniet-algolia.json') }
          if (url === PLATE_URL) return { ok: true, html: productPage }
          return { ok: false, reason: 'blocked (HTTP 403)' }
        },
      })

    const fromSearch = await run('<html><div id="root"></div></html>')
    expect(calls.filter((c) => c.url === PLATE_ALGOLIA)).toHaveLength(1)
    expect(calls.find((c) => c.url === PLATE_ALGOLIA)!.init.headers['X-Algolia-API-Key']).toBe(ALGOLIA_STORES.Platekompaniet.apiKey)
    expect(fromSearch.results).toEqual([expect.objectContaining({ store: 'Platekompaniet', price: 699, verified: 'store-search', matchedBy: 'code' })])

    const fromPage = await run(pageWithPrice)
    expect(fromPage.results).toEqual([expect.objectContaining({ store: 'Platekompaniet', price: 649, verified: true, availability: 'InStock', matchedBy: 'code' })])
  })
})

test.describe('merging direct and AI results', () => {
  const direct = (url: string, matchedBy: 'code' | 'name', price = 279): DirectResult => ({
    store: 'Outland', price, currency: 'NOK', url, inStock: true, verified: true, matchedBy, direct: true,
  })

  test('sure matches first, then AI, then name matches; one entry per page, the direct one wins', () => {
    const ai = [
      { store: 'Outland', price: 349, currency: 'NOK', url: 'https://outland.no/p/flareon/', verified: false },
      { store: 'Proshop', price: 299, currency: 'NOK', url: 'https://www.proshop.no/x', verified: false },
    ]
    // The name match is at another store: a name match at the same store as a code match is
    // dropped (see edition-match.spec.ts).
    const merged = mergeFindPricesResults(ai, [direct('https://www.power.no/p/beast', 'name'), direct('https://www.outland.no/p/flareon', 'code')])
    expect(merged.map((r) => [r.url, r.price])).toEqual([
      ['https://www.outland.no/p/flareon', 279],
      ['https://www.proshop.no/x', 299],
      ['https://www.power.no/p/beast', 279],
    ])
  })

  test('the diagnostic line includes the store search and an AI failure', () => {
    const stores = [{ store: 'Outland', found: 1 }, { store: 'Komplett', found: 0 }, { store: 'Ark', found: 0, reason: 'blocked (HTTP 429)' }]
    expect(describeFindPricesDiagnostics({ searches: 6, candidates: 0, dropped: [], stores })).toBe(
      '6 searches, 0 candidates found. Store search: Outland 1 found, Komplett no match, Ark skipped (blocked (HTTP 429)).'
    )
    expect(describeFindPricesDiagnostics({ searches: 0, candidates: 0, dropped: [], stores, aiError: 'Search timed out — try again' })).toBe(
      'AI search failed: Search timed out — try again. Store search: Outland 1 found, Komplett no match, Ark skipped (blocked (HTTP 429)).'
    )
  })
})

async function findWith(page: import('@playwright/test').Page, body: Record<string, unknown>) {
  await page.route('**/api/find-prices', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
  await page.goto('/add-price')
  await page.locator('#p-name').fill(testName('Beast Ball (pokemon replica, Wand Company)'))
  await page.locator('#p-category').selectOption('figure')
  await page.locator('input[name="p-source"][value="norway"]').check()
  await page.locator('#p-find-prices-btn').click()
}

test.describe('add-price: direct store lookup results', () => {
  test('a sure store match is labelled, and the store search line is shown under the results', async ({ page }) => {
    await findWith(page, {
      ok: true,
      results: [
        { store: 'Outland', price: 2499, currency: 'NOK', url: 'https://www.outland.no/p/p-beast-ball-test', inStock: true, verified: true, matchedBy: 'code', direct: true },
        { store: 'Proshop', price: 2399, currency: 'NOK', url: 'https://www.proshop.no/test', inStock: null, verified: false },
      ],
      diagnostics: { searches: 6, candidates: 1, dropped: [], stores: [{ store: 'Outland', found: 1 }, { store: 'Elkjøp', found: 0, reason: 'blocked (HTTP 429)' }] },
    })

    const items = page.locator('.ap-find-prices-item')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0).locator('.ap-find-prices-meta')).toContainText("Found in the store's own search · Same barcode/ISBN")
    await expect(items.nth(0).locator('.ap-find-prices-check')).toHaveText('✓ Price checked on page')
    await expect(items.nth(1).locator('.ap-find-prices-meta')).toHaveCount(0)
    await expect(page.locator('.ap-find-prices-diagnostics')).toHaveText(
      '6 searches, 1 candidate found. Store search: Outland 1 found, Elkjøp skipped (blocked (HTTP 429)).'
    )
  })

  test('AI search failed but the store search found it: results shown, with the reason', async ({ page }) => {
    await findWith(page, {
      ok: true,
      results: [{ store: 'Outland', price: 2499, currency: 'NOK', url: 'https://www.outland.no/p/p-beast-ball-test', inStock: true, verified: true, matchedBy: 'name', direct: true }],
      diagnostics: { searches: 0, candidates: 0, dropped: [], stores: [{ store: 'Outland', found: 1 }], aiError: 'Search timed out — try again' },
    })

    await expect(page.locator('.ap-find-prices-item')).toHaveCount(1)
    await expect(page.locator('.ap-find-prices-meta')).toContainText("Found in the store's own search")
    await expect(page.locator('.ap-find-prices-meta')).not.toContainText('same barcode')
    await expect(page.locator('.ap-find-prices-diagnostics')).toContainText('AI search failed: Search timed out — try again. Store search: Outland 1 found.')
  })

  test('a price from the store\'s own search data gets its own label', async ({ page }) => {
    await findWith(page, {
      ok: true,
      results: [
        { store: 'Norli', price: 529, currency: 'NOK', url: 'https://www.norli.no/boker/test-fixture-9781408845691', inStock: true, verified: 'store-search', matchedBy: 'code', direct: true },
        { store: 'Outland', price: 579, currency: 'NOK', url: 'https://www.outland.no/p/test-fixture', inStock: null, verified: true, matchedBy: 'code', direct: true },
        { store: 'Proshop', price: 549, currency: 'NOK', url: 'https://www.proshop.no/test-fixture', inStock: null, verified: false },
      ],
      diagnostics: { searches: 6, candidates: 1, dropped: [], stores: [{ store: 'Norli', found: 1 }, { store: 'Outland', found: 1 }] },
    })
    const checks = page.locator('.ap-find-prices-check')
    await expect(checks.nth(0)).toHaveText("Price from the store's own search")
    await expect(checks.nth(0)).toHaveClass(/ap-find-prices-check-store/)
    await expect(checks.nth(1)).toHaveText('✓ Price checked on page')
    await expect(checks.nth(2)).toHaveText('Unverified (from search)')
  })

  test('nothing found anywhere: the message lists the store search too', async ({ page }) => {
    await findWith(page, {
      ok: true,
      results: [],
      diagnostics: { searches: 6, candidates: 0, dropped: [], stores: [{ store: 'Outland', found: 0 }, { store: 'Proshop', found: 0, reason: 'blocked (HTTP 403)' }] },
    })
    await expect(page.locator('#p-find-prices-msg')).toHaveText(
      'No reliable prices found. 6 searches, 0 candidates found. Store search: Outland no match, Proshop skipped (blocked (HTTP 403)).'
    )
  })
})
