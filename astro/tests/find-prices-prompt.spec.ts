import { test, expect } from './fixtures'
import { buildFindPricesSystemPrompt, norwayStoresFor, NORWAY_STORES } from '../src/lib/find-prices-prompt'

// Exercises buildFindPricesSystemPrompt() directly, the same way itinerary.spec.ts tests
// route-optimizer.ts/itinerary-review-helpers.ts — the only way to deterministically verify
// "the prompt for each category contains its stores" without a real Anthropic call. A true
// HTTP-level mock of find-prices.ts's own outgoing fetch isn't reachable from here: that
// fetch happens inside find-prices.ts, a separate Node process (the Astro dev server) that
// Playwright's page.route() has no visibility into, and find-prices.ts itself can't be
// imported directly in a test file either — it uses `import.meta.env` (Vite/Astro-only
// syntax), which fails to even parse under Playwright's test transform, for any import from
// that file. buildFindPricesSystemPrompt() is exactly the function whose return value
// becomes the request's `system` field, so testing it directly inspects precisely the part
// of the request this change affects.
test.describe('find-prices system prompt: Norwegian store list', () => {
  test('every category includes all the general stores', () => {
    for (const category of ['album', 'game', 'book', 'figure', 'other']) {
      const prompt = buildFindPricesSystemPrompt(category)
      for (const store of NORWAY_STORES.general) {
        expect(prompt, `${category} should mention ${store}`).toContain(store)
      }
    }
  })

  test('album additionally includes Platekompaniet, not the book-only stores', () => {
    const prompt = buildFindPricesSystemPrompt('album')
    expect(prompt).toContain('Platekompaniet')
    for (const store of ['Ark', 'Norli', 'Tanum', 'Adlibris']) {
      expect(prompt).not.toContain(store)
    }
  })

  test('book additionally includes Ark, Norli, Tanum and Adlibris, not Platekompaniet', () => {
    const prompt = buildFindPricesSystemPrompt('book')
    for (const store of ['Ark', 'Norli', 'Tanum', 'Adlibris']) {
      expect(prompt).toContain(store)
    }
    expect(prompt).not.toContain('Platekompaniet')
  })

  test('figure and game stay at just the general stores (their own groups add nothing new)', () => {
    for (const category of ['figure', 'game']) {
      const prompt = buildFindPricesSystemPrompt(category)
      expect(prompt).not.toContain('Platekompaniet')
      for (const store of ['Ark', 'Norli', 'Tanum', 'Adlibris']) {
        expect(prompt).not.toContain(store)
      }
    }
  })

  test('"other" (no specific group) gets only the general stores', () => {
    const prompt = buildFindPricesSystemPrompt('other')
    expect(prompt).not.toContain('Platekompaniet')
    for (const store of ['Ark', 'Norli', 'Tanum', 'Adlibris']) {
      expect(prompt).not.toContain(store)
    }
  })

  test('still invites other Norwegian stores the search finds, not just the named list', () => {
    const prompt = buildFindPricesSystemPrompt('game')
    expect(prompt).toContain('other Norwegian shops you find')
  })

  test('a store in both the general list and its category group is not duplicated', () => {
    // Outland is in both NORWAY_STORES.general and NORWAY_STORES.figure.
    const stores = norwayStoresFor('figure')
    expect(stores.filter((s) => s === 'Outland')).toHaveLength(1)
  })
})
