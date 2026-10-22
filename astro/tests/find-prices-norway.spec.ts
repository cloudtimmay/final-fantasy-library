import { test, expect, testName } from './fixtures'
import {
  NORWAY_STORES,
  NORWAY_STORE_SITES,
  NORWAY_MAX_SEARCHES,
  buildFindPricesSystemPrompt,
  norwaySearchQueries,
  norwayStoreSearchLinks,
  searchName,
} from '../src/lib/find-prices-prompt'
import { validateFindPricesResults, describeFindPricesDiagnostics } from '../src/lib/find-prices-results'

// Pure-module tests, same approach as find-prices-prompt.spec.ts — find-prices.ts itself
// can't be imported here, and its outgoing Anthropic call can't be intercepted.
test.describe('find-prices: targeted Norway searches', () => {
  test('every store in the category lists has a site entry with a domain', () => {
    const all = new Set(Object.values(NORWAY_STORES).flat())
    for (const store of all) {
      expect(NORWAY_STORE_SITES[store], store).toBeTruthy()
      expect(NORWAY_STORE_SITES[store].domain, store).toMatch(/^[a-z0-9.-]+\.[a-z]+$/)
    }
  })

  test('searchName drops a parenthetical note', () => {
    expect(searchName('Beast Ball (pokemon replica, Wand Company)')).toBe('Beast Ball')
    expect(searchName('Final Fantasy VII Remake')).toBe('Final Fantasy VII Remake')
    expect(searchName('(only a note)')).toBe('(only a note)')
  })

  test('figure: site: searches, Outland first, short name', () => {
    const q = norwaySearchQueries('figure', { productName: 'Beast Ball (pokemon replica, Wand Company)' })
    expect(q[0]).toBe('site:outland.no Beast Ball')
    expect(q.every((x) => x.startsWith('site:'))).toBe(true)
    expect(q.length).toBeLessThanOrEqual(NORWAY_MAX_SEARCHES)
  })

  test('the first store is also searched by JAN and Japanese name when given', () => {
    const q = norwaySearchQueries('figure', { productName: 'Beast Ball', productNameJp: 'ウルトラボール', jan: '5060178520736' })
    expect(q.slice(0, 3)).toEqual([
      'site:outland.no Beast Ball',
      'site:outland.no 5060178520736',
      'site:outland.no ウルトラボール',
    ])
  })

  test('book: the book stores come before the general ones, capped at the search budget', () => {
    const q = norwaySearchQueries('book', { productName: 'Art of Final Fantasy XVI' })
    expect(q[0]).toBe('site:outland.no Art of Final Fantasy XVI')
    expect(q).toContain('site:ark.no Art of Final Fantasy XVI')
    expect(q).toHaveLength(NORWAY_MAX_SEARCHES)
  })

  test('the system prompt tells the model to search, and to search stores with site:', () => {
    const prompt = buildFindPricesSystemPrompt('figure')
    expect(prompt).toContain('must use it at least once')
    expect(prompt).toContain('site:outland.no')
  })

  test('store search links: one per store with a search URL, product name encoded', () => {
    const links = norwayStoreSearchLinks('figure', 'Beast Ball (pokemon replica, Wand Company)')
    expect(links[0]).toEqual({ store: 'Outland', url: 'https://www.outland.no/search?q=Beast%20Ball' })
    expect(links.map((l) => l.store)).toEqual(['Outland', 'Komplett', 'Elkjøp', 'Power', 'Proshop', 'CDON'])

    const books = norwayStoreSearchLinks('book', 'Art of Final Fantasy XVI').map((l) => l.store)
    expect(books).toContain('Tanum (Cappelen Damm)')
    expect(books).not.toContain('Adlibris') // no confirmed search URL — see NORWAY_STORE_SITES
  })
})

test.describe('find-prices: result validation with drop reasons', () => {
  const seen = new Set(['outland.no', 'proshop.no'])

  test('keeps a valid NOK result and records a reason for each dropped one', () => {
    const { results, dropped, candidates } = validateFindPricesResults(
      [
        { store: 'Outland', price: 2499, currency: 'NOK', url: 'https://www.outland.no/p/beast-ball', inStock: true },
        { store: 'Proshop', price: 30, currency: 'EUR', url: 'https://www.proshop.no/x' },
        { store: 'Komplett', price: 2299, currency: 'NOK', url: 'https://www.komplett.no/x' },
        { store: 'Power', price: 999, currency: 'NOK', url: 'https://www.power.no/x', rejected: 'different edition' },
        { store: 'Elkjøp', currency: 'NOK', url: 'https://www.elkjop.no/x' },
      ],
      'norway',
      seen
    )
    expect(candidates).toBe(5)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ store: 'Outland', price: 2499, currency: 'NOK' })
    expect(dropped).toEqual([
      { store: 'Proshop', reason: 'price in EUR, not NOK' },
      { store: 'Komplett', reason: 'link not from the search results' },
      { store: 'Power', reason: 'not a match: different edition' },
      { store: 'Elkjøp', reason: 'no price' },
    ])
  })

  test('the summary says how many searches, candidates and drops, and why', () => {
    expect(describeFindPricesDiagnostics({ searches: 0, candidates: 0, dropped: [] })).toBe('The AI did not run any web search.')
    expect(describeFindPricesDiagnostics({ searches: 6, candidates: 0, dropped: [] })).toBe('6 searches, 0 candidates found.')
    expect(
      describeFindPricesDiagnostics({ searches: 6, candidates: 1, dropped: [{ store: 'Proshop', reason: 'price in EUR, not NOK' }] })
    ).toBe('6 searches, 1 candidate found, 1 dropped: Proshop (price in EUR, not NOK)')
  })
})

async function fillForFindPrices(page: import('@playwright/test').Page, region: 'norway' | 'online') {
  await page.goto('/add-price')
  await page.locator('#p-name').fill(testName('Beast Ball (pokemon replica, Wand Company)'))
  await page.locator('#p-category').selectOption('figure')
  await page.locator(`input[name="p-source"][value="${region}"]`).check()
}

test.describe('add-price: Find prices diagnostics and store fallback', () => {
  test('nothing found: shows why, plus "Search on <store>" links for the category', async ({ page }) => {
    await page.route('**/api/find-prices', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [],
          diagnostics: { searches: 6, candidates: 2, dropped: [{ store: 'Proshop', reason: 'price in EUR, not NOK' }, { store: 'Komplett', reason: 'not a match: different edition' }] },
        }),
      })
    )
    await fillForFindPrices(page, 'norway')
    await page.locator('#p-find-prices-btn').click()

    await expect(page.locator('#p-find-prices-msg')).toContainText(
      'No reliable prices found. 6 searches, 2 candidates found, 2 dropped: Proshop (price in EUR, not NOK), Komplett (not a match: different edition)'
    )
    const outland = page.locator('.ap-find-prices-store-search', { hasText: 'Search on Outland' })
    await expect(outland).toBeVisible()
    // searchName() drops both the "[test] " prefix and the parenthetical note.
    await expect(outland).toHaveAttribute('href', 'https://www.outland.no/search?q=Beast%20Ball')
    await expect(outland).toHaveAttribute('target', '_blank')
    await expect(page.locator('.ap-find-prices-store-search')).toHaveCount(6)
  })

  test('results found: the store links are shown under them too', async ({ page }) => {
    await page.route('**/api/find-prices', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [{ store: 'Outland', price: 2499, currency: 'NOK', url: 'https://www.outland.no/p/test-fixture', inStock: true }],
          diagnostics: { searches: 6, candidates: 1, dropped: [] },
        }),
      })
    )
    await fillForFindPrices(page, 'norway')
    await page.locator('#p-find-prices-btn').click()

    await expect(page.locator('.ap-find-prices-item')).toHaveCount(1)
    await expect(page.locator('.ap-find-prices-store-search', { hasText: 'Search on Outland' })).toBeVisible()
  })

  test('an Online search gets no Norwegian store links', async ({ page }) => {
    await page.route('**/api/find-prices', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results: [], diagnostics: { searches: 5, candidates: 0, dropped: [] } }) })
    )
    await fillForFindPrices(page, 'online')
    await page.locator('#p-find-prices-btn').click()

    await expect(page.locator('#p-find-prices-msg')).toContainText('5 searches, 0 candidates found.')
    await expect(page.locator('.ap-find-prices-store-search')).toHaveCount(0)
  })
})
