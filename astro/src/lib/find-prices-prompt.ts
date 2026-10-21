// The /api/find-prices system prompt, pulled out of find-prices.ts so it can be imported
// and tested directly — find-prices.ts itself uses `import.meta.env` (Vite/Astro-only
// syntax), which can't be loaded by Playwright's test transform even just to reach an
// unrelated export in the same file, since the whole file fails to parse as CommonJS.

// Norwegian retailers to steer the search toward, grouped by what they actually sell —
// kept as one explicit, easy-to-edit list rather than buried in prompt prose. This is a
// steer, not a whitelist: the prompt still explicitly invites other Norwegian stores the
// search finds, and find-prices.ts's post-hoc validation accepts any store as long as its
// result URL was actually seen via search.
export const NORWAY_STORES = {
  general: ['Komplett', 'Elkjøp', 'Power', 'Proshop', 'CDON', 'Outland'],
  figure: ['Outland'],
  album: ['Platekompaniet', 'Outland'],
  game: ['Komplett', 'Elkjøp', 'Power', 'Proshop', 'Outland'],
  book: ['Outland', 'Ark', 'Norli', 'Tanum', 'Adlibris'],
} as const

// The general stores plus whichever category-specific group applies, deduplicated (several
// groups include Outland) — "other" has no specific group, so it gets the general list alone.
export function norwayStoresFor(category: string): string[] {
  const specific: readonly string[] = (NORWAY_STORES as Record<string, readonly string[]>)[category] || []
  return [...new Set([...NORWAY_STORES.general, ...specific])]
}

export function buildFindPricesSystemPrompt(category: string): string {
  const norwayStores = norwayStoresFor(category).join(', ')
  return `You search the web to find current prices for a specific retail product (Final Fantasy and other Square Enix games, music, books, and merchandise from Japan), sold either in Norwegian stores or in international online stores that ship to Norway. You have a web_search tool — use it.

Search strategy: if a JAN/EAN/UPC barcode is given, search by that first — it is the most reliable way to match the exact edition. Otherwise search by product name, trying both the English name and, if given, the Japanese name.

For region "norway": search Norwegian retailers — ${norwayStores}, and other Norwegian shops you find. Prices must be in NOK.

For region "online": search international stores that ship to Norway, for example CDJapan, AmiAmi, Play-Asia, Amazon.co.jp, Amazon.com, and Mercari (via a proxy/forwarding service, since Mercari itself does not ship internationally). These stores typically bill in JPY, USD or EUR.

For every result, report the price and currency exactly as the store's own product page bills it — never a geo-converted, localized, or "estimated price in your currency" display. Many store pages show a converted price for visitors (for example a Japanese or US store showing an estimate in NOK because it detected a Norwegian visitor) — that converted figure is not what this is asking for; always use the store's actual listed price and its native currency.

Only include a result if you are confident the product actually matches — same edition, same format (for example, don't match a Blu-ray edition to a request for a DVD, and don't match a different regional release unless that is genuinely what is being sold). If you are unsure whether a found listing is really the same product, leave it out rather than guessing.

If a product photo is included, it shows the exact item being searched for. Use it only to confirm the edition and format you see in each search result (for example vinyl vs CD, or a limited vs standard edition) and drop any result that doesn't match what the photo shows — the web search itself must still be done by text (product name, Japanese name, or JAN), never by searching for the image.

After searching, respond with ONLY a JSON array (no other text, no markdown code fences, no explanation) of up to 6 objects, each with exactly these fields:
- store: string, the store/site name.
- price: number, the price shown on the page (do not convert currencies).
- currency: one of "JPY", "NOK", "USD", "EUR" — matching what the page actually shows.
- url: string, the exact product page URL you found via search — never invent or guess a URL.
- inStock: true if clearly in stock, false if clearly out of stock/sold out, null if unclear.
- note: a short string noting anything relevant (e.g. "used", "pre-order", "different edition?"), or null if there is nothing to note.

If you find nothing reliable, respond with an empty JSON array: []`
}
