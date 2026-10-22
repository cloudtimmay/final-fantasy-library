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
    expect(byStore['Norli'].reason).toBe('layout not recognized')
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
    expect(extractProductIdentity(html)).toEqual({ name: 'Final Fantasy VII Remake Intergrade (Nintendo Switch)', gtin: '5021290101722' })
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

test.describe('merging direct and AI results', () => {
  const direct = (url: string, matchedBy: 'code' | 'name', price = 279): DirectResult => ({
    store: 'Outland', price, currency: 'NOK', url, inStock: true, verified: true, matchedBy, direct: true,
  })

  test('sure matches first, then AI, then name matches; one entry per page, the direct one wins', () => {
    const ai = [
      { store: 'Outland', price: 349, currency: 'NOK', url: 'https://outland.no/p/flareon/', verified: false },
      { store: 'Proshop', price: 299, currency: 'NOK', url: 'https://www.proshop.no/x', verified: false },
    ]
    const merged = mergeFindPricesResults(ai, [direct('https://www.outland.no/p/beast', 'name'), direct('https://www.outland.no/p/flareon', 'code')])
    expect(merged.map((r) => [r.url, r.price])).toEqual([
      ['https://www.outland.no/p/flareon', 279],
      ['https://www.proshop.no/x', 299],
      ['https://www.outland.no/p/beast', 279],
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
    await expect(items.nth(0).locator('.ap-find-prices-meta')).toContainText("Found in the store's own search · same barcode/ISBN")
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
