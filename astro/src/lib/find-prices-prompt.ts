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

// Each store's own site: `domain` for targeted "site:" searches, and `searchUrl` — the store's
// own search results page, with the query appended (URL-encoded) — for the "Search on
// <store>" fallback buttons on /add-price. Checked against the live sites in October 2026:
// Outland and Proshop by fetching a results page; Power and Cappelen Damm from their own
// schema.org SearchAction; CDON from its SearchAction urlTemplate; Elkjøp and Ark from their
// search <form>; Platekompaniet and Norli from their site's JS ("/search?query=") and
// robots.txt ("Disallow: /search"). Komplett is NOT verified — it resets every automated
// request — so its URL is the conventional one. tanum.no now redirects to cappelendamm.no.
// Adlibris has no searchUrl: adlibris.com/no redirected to adlibris.com/nb/stengt ("closed"),
// which couldn't be confirmed past its bot check, so no button is offered for it.
export const NORWAY_STORE_SITES: Record<string, { label?: string; domain: string; searchUrl: string | null }> = {
  Outland: { domain: 'outland.no', searchUrl: 'https://www.outland.no/search?q=' },
  Komplett: { domain: 'komplett.no', searchUrl: 'https://www.komplett.no/search?q=' },
  'Elkjøp': { domain: 'elkjop.no', searchUrl: 'https://www.elkjop.no/search?q=' },
  Power: { domain: 'power.no', searchUrl: 'https://www.power.no/search/?q=' },
  Proshop: { domain: 'proshop.no', searchUrl: 'https://www.proshop.no/?s=' },
  CDON: { domain: 'cdon.no', searchUrl: 'https://cdon.no/s/?q=' },
  Platekompaniet: { domain: 'platekompaniet.no', searchUrl: 'https://www.platekompaniet.no/search?query=' },
  Ark: { domain: 'ark.no', searchUrl: 'https://www.ark.no/sok?text=' },
  Norli: { domain: 'norli.no', searchUrl: 'https://www.norli.no/search?query=' },
  Tanum: { label: 'Cappelen Damm', domain: 'cappelendamm.no', searchUrl: 'https://www.cappelendamm.no/search?query=' },
  Adlibris: { domain: 'adlibris.com', searchUrl: null },
}

// The category-specific group first, then the general stores, deduplicated (several groups
// include Outland) — specific first because that's where the product is most likely to be,
// and the search budget may run out before the end of the list. "other" has no specific
// group, so it gets the general list alone.
export function norwayStoresFor(category: string): string[] {
  const specific: readonly string[] = (NORWAY_STORES as Record<string, readonly string[]>)[category] || []
  return [...new Set([...specific, ...NORWAY_STORES.general])]
}

// A store's own title is usually shorter than what's typed into /add-price — e.g. Outland
// lists "Beast Ball (pokemon replica, Wand Company)" as "Beast Ball Diecast Replica" — so a
// parenthetical note is dropped before searching, since every word of it narrows the search.
export function searchName(productName: string): string {
  const short = productName.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  return short || productName.trim()
}

// Up to 6 web searches per Norway request (find-prices.ts NORWAY_MAX_SEARCHES).
export const NORWAY_MAX_SEARCHES = 6

// The exact searches to run for region "norway", in priority order: the first store by
// English name, then by JAN and Japanese name (if given), then the remaining stores by
// English name. Generic searches surface international stores (in testing, 39 hits from US/
// AU/UK shops and none from a Norwegian one), so every one of these is a site: search.
export function norwaySearchQueries(
  category: string,
  product: { productName: string; productNameJp?: string; jan?: string },
  max: number = NORWAY_MAX_SEARCHES
): string[] {
  const domains = norwayStoresFor(category).map((s) => NORWAY_STORE_SITES[s]?.domain).filter((d): d is string => !!d)
  const name = searchName(product.productName)
  const [first, ...rest] = domains
  const queries = [`site:${first} ${name}`]
  if (product.jan) queries.push(`site:${first} ${product.jan}`)
  if (product.productNameJp) queries.push(`site:${first} ${product.productNameJp}`)
  for (const d of rest) queries.push(`site:${d} ${name}`)
  return queries.slice(0, max)
}

// "Search on <store>" fallback links for /add-price — the category's Norwegian stores, each
// opening that store's own search page for the product name. Stores without a known
// searchUrl are left out.
export function norwayStoreSearchLinks(category: string, productName: string): { store: string; url: string }[] {
  const q = encodeURIComponent(searchName(productName))
  return norwayStoresFor(category)
    .map((s) => ({ s, site: NORWAY_STORE_SITES[s] }))
    .filter(({ site }) => !!site?.searchUrl)
    .map(({ s, site }) => ({ store: site.label || s, url: site.searchUrl + q }))
}

export function buildFindPricesSystemPrompt(category: string): string {
  const norwayStores = norwayStoresFor(category).join(', ')
  return `You search the web to find current prices for a specific retail product (Final Fantasy and other Square Enix games, music, books, merchandise and other collectibles), sold either in Norwegian stores or in international online stores that ship to Norway. You have a web_search tool — you must use it at least once before answering; never answer from memory.

Search strategy: if a JAN/EAN/UPC barcode is given, search by that first — it is the most reliable way to match the exact edition. Otherwise search by product name, trying both the English name and, if given, the Japanese name.

For region "norway": search Norwegian retailers — ${norwayStores}, and other Norwegian shops you find. Prices must be in NOK. General searches mostly return international stores, so search each store directly with "site:" (for example "site:outland.no Beast Ball"). The request lists the exact searches to run — run them in that order. A store's own product title is often shorter or worded differently from the name given (for example "Diecast Replica" instead of "pokemon replica"), so judge a hit by what the product is, not by exact wording.

For region "online": search international stores that ship to Norway, for example CDJapan, AmiAmi, Play-Asia, Amazon.co.jp, Amazon.com, and Mercari (via a proxy/forwarding service, since Mercari itself does not ship internationally). These stores typically bill in JPY, USD or EUR.

For every result, report the price and currency exactly as the store's own product page bills it — never a geo-converted, localized, or "estimated price in your currency" display. Many store pages show a converted price for visitors (for example a Japanese or US store showing an estimate in NOK because it detected a Norwegian visitor) — that converted figure is not what this is asking for; always use the store's actual listed price and its native currency.

Only include a result if you are confident the product actually matches — same edition, same format (for example, don't match a Blu-ray edition to a request for a DVD, and don't match a different regional release unless that is genuinely what is being sold). If you are unsure whether a found listing is really the same product, leave it out rather than guessing.

If a product photo is included, it shows the exact item being searched for. Use it only to confirm the edition and format you see in each search result (for example vinyl vs CD, or a limited vs standard edition) and drop any result that doesn't match what the photo shows — the web search itself must still be done by text (product name, Japanese name, or JAN), never by searching for the image.

After searching, respond with ONLY a JSON array (no other text, no markdown code fences, no explanation) of up to 6 matching listings, plus up to 4 listings you found but rejected, each with exactly these fields:
- store: string, the store/site name.
- price: number, the price shown on the page (do not convert currencies).
- currency: one of "JPY", "NOK", "USD", "EUR" — matching what the page actually shows.
- url: string, the exact product page URL you found via search — never invent or guess a URL.
- inStock: true if clearly in stock, false if clearly out of stock/sold out, null if unclear.
- note: a short string noting anything relevant (e.g. "used", "pre-order", "different edition?"), or null if there is nothing to note.
- rejected: null for a matching listing; for a listing you found but are not using, a short reason (e.g. "different edition", "different product", "price not shown").

If you find nothing at all, respond with an empty JSON array: []`
}
