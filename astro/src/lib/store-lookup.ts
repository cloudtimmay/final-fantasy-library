// Direct store lookup for Find prices (Norway): searches each Norwegian store's own site
// server-side, reads the product pages it finds, and keeps the ones that really are the
// product — alongside the AI web search, which only sees what a search engine has indexed.
//
// Which stores work server-side was checked in October 2026 (searching by ISBN, EAN and name):
// - Outland: yes, but only with the query in the PATH (/search/<q>) — /search?q= ignores the
//   query server-side and returns the default listing of all ~82 000 products.
// - Komplett: yes (?q=, also by EAN); results are embedded as JSON (preloadedSearchResult).
// - Cappelen Damm (Tanum): yes (?query=, by ISBN or name); result links end in the ISBN.
// - Power: yes, through the JSON API its own search page calls (GET /api/v2/productlists?q=),
//   by name only — an EAN query returns no hits. Product pages have JSON-LD with the GTIN.
// - Norli, Platekompaniet: no. Their search runs on Algolia in the browser. Norli's Algolia
//   key comes from a GraphQL mutation and is bound to the caller's IP (two requests per
//   search); Platekompaniet's key is public in its storeConfig. Both searches work from Node,
//   but both stores' product pages are browser-only shells with no structured data, so a
//   price can't be checked on the page — checked October 2026.
// - Ark, Elkjøp: no — HTTP 429 (bot protection). CDON, Proshop: no — HTTP 403.
// Stores that fail are tried anyway (in parallel, so it costs no time) and reported in the
// diagnostic line, so a store that starts working again shows up without a code change.
import { NORWAY_STORE_SITES, norwayStoresFor, searchName } from './find-prices-prompt'
import { extractPagePrice, extractProductIdentity, type Availability } from './page-price'
import { compareNames, normalizeCode } from './product-match'
import type { StoreOutcome } from './find-prices-results'
import { editionConflict } from './edition'

export const SEARCH_TIMEOUT_MS = 6000
export const PRODUCT_TIMEOUT_MS = 5000
export const MAX_PRODUCTS_PER_STORE = 3
const MIN_FETCH_MS = 500
const MAX_PAGE_BYTES = 5 * 1024 * 1024
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export type FetchResult = { ok: true; html: string } | { ok: false; reason: string }
// `init` is only for the stores whose search is an API call (a POST with a JSON body).
export type FetchInit = { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }
export type FetchHtml = (url: string, timeoutMs: number, init?: FetchInit) => Promise<FetchResult>

// The real fetch, shared with find-prices.ts's page-price check: normal browser headers, a
// hard timeout, and a reason on failure for the diagnostic line.
export const fetchHtml: FetchHtml = async (url, timeoutMs, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: init?.method || 'GET',
      body: init?.body,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8', ...init?.headers },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (res.status === 403 || res.status === 429) return { ok: false, reason: `blocked (HTTP ${res.status})` }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    if (Number(res.headers.get('content-length') || 0) > MAX_PAGE_BYTES) return { ok: false, reason: 'page too large' }
    const html = await res.text()
    return html.length > MAX_PAGE_BYTES ? { ok: false, reason: 'page too large' } : { ok: true, html }
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timed out' : 'network error' }
  } finally {
    clearTimeout(timer)
  }
}

// --- per-store rules ----------------------------------------------------------------------

// `price`/`inStock` are only set by a store whose own search data carries them (the Algolia
// stores below) — used when the product page itself has no structured price.
// `edition`: any edition/format text the search data has besides the name (Norli's sub_title
// "Illustrated Edition" and format "Innbundet") — the name alone often doesn't say.
export type StoreCandidate = { url: string; name?: string | null; code?: string | null; price?: number | null; inStock?: boolean | null; edition?: string | null }

export type SearchContext = { fetchPage: FetchHtml; timeout: (maxMs: number) => number }
export type SearchOutcome = { ok: true; candidates: StoreCandidate[] } | { ok: false; reason: string }

type StoreRule = {
  // Overrides NORWAY_STORE_SITES[store].searchUrl for server-side searching.
  searchUrl?: (query: string) => string
  // The product links on a search page. null = layout not recognized; [] = no hits.
  candidates?: (html: string, pageUrl: string) => StoreCandidate[] | null
  // 'name': search by name only — one request per search, for a store whose search finds
  // nothing by JAN/ISBN. Default: JAN/ISBN first, then the name if that finds nothing.
  searchBy?: 'name'
  // A store whose search is an API call rather than a page: runs every query itself (in
  // as few requests as it can) and returns the candidates, best query first.
  search?: (queries: string[], ctx: SearchContext) => Promise<SearchOutcome>
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function outlandCandidates(html: string): StoreCandidate[] | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  let products: any
  try { products = JSON.parse(m[1])?.props?.pageProps?.products } catch { return null }
  if (!products || !Array.isArray(products.items)) return null
  // The unfiltered default listing (the whole catalog, ~82 000 products in October 2026)
  // means the query wasn't applied. A broad real query can still match many — "Final Fantasy
  // Resonance" matched 15 961 — so the line is drawn well above that.
  if (typeof products.total_count === 'number' && products.total_count > 50000) return null
  return products.items
    .filter((i: any) => typeof i?.url_key === 'string' && i.url_key)
    .map((i: any) => ({ url: `https://www.outland.no/p/${i.url_key}`, name: i.name ?? null, code: i.sku ?? null }))
}

function komplettCandidates(html: string): StoreCandidate[] | null {
  const m = html.match(/preloadedSearchResult='([^']*)'/)
  if (!m) return null
  let data: any
  try { data = JSON.parse(decodeEntities(m[1])) } catch { return null }
  if (!Array.isArray(data?.products)) return null
  return data.products
    .filter((p: any) => typeof p?.url === 'string' && p.url.startsWith('/product/'))
    .map((p: any) => ({ url: 'https://www.komplett.no' + p.url, name: p.name ?? null, code: null }))
}

function cappelenDammCandidates(html: string): StoreCandidate[] | null {
  const urls = [...new Set([...html.matchAll(/href="(\/boker\/[^"?#]+)"/g)].map((m) => m[1]))]
  if (urls.length === 0) return /NumberOfHits|search\?query=/.test(html) ? [] : null
  return urls.map((path) => ({ url: 'https://www.cappelendamm.no' + path, code: (path.match(/-(\d{13})$/) || [])[1] ?? null }))
}

// Power's search API: { products: [{ title, url: "/gaming/.../p-4198158/", price, ... }] }.
// No EAN in the listing — the product page has it (JSON-LD gtin13).
function powerCandidates(body: string): StoreCandidate[] | null {
  let data: any
  try { data = JSON.parse(body) } catch { return null }
  if (!Array.isArray(data?.products)) return null
  return data.products
    .filter((p: any) => typeof p?.url === 'string' && p.url.startsWith('/'))
    .map((p: any) => ({ url: 'https://www.power.no' + p.url, name: p.title ?? null, code: null }))
}

// --- Algolia stores (Platekompaniet, Norli) ------------------------------------------------
// Both search through Algolia in the browser, and both have product pages that are browser-
// only shells with no structured data — so their price comes from the store's own search
// data (verified: 'store-search'), unless a product page ever does expose one. The app id,
// index and where the key comes from, all in one place:
// - Platekompaniet: the public search key from its storeConfig (GraphQL getStoreConfigData,
//   algoliasearch_api_key) — not tied to an IP, so it's used as-is. Read October 2026; if
//   it's rotated, Algolia answers 403 and the store is skipped with that reason.
// - Norli: no public key — its site asks GraphQL (mutation createAlgoliaKey) for one per
//   visitor, restricted to the caller's IP, so a fresh one is fetched on every search.
export const ALGOLIA_STORES = {
  Platekompaniet: {
    appId: 'H4ZQSN0RMC',
    index: 'plate_prod_default_products',
    apiKey: 'NTA5ZGNjMjBlM2FmZTMwZWQxZTlkMTNiYzQxN2RiMTAwMmRmYWE4ZDczZWQwYWQ3NTk3ZTA5ZTlhNGM4ZDFjYXRhZ0ZpbHRlcnM9',
  },
  Norli: {
    appId: 'AEEYIEERSJ',
    index: 'norli_pwa_products',
    keyUrl: 'https://www.norli.no/graphql',
  },
} as const

const NORLI_KEY_MUTATION = 'mutation createAlgoliaKey($userToken: String!) {\n  createAlgoliaKey(input: {user_token: $userToken})\n}\n'
const ALGOLIA_HITS_PER_QUERY = 10

function algoliaCode(hit: any): string | null {
  for (const v of [hit?.ean, hit?.isbn, hit?.sku]) {
    // Platekompaniet's ean is a JSON number and its sku an internal number; only a
    // barcode-shaped value counts.
    const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
    if (/^(\d{8}|\d{12,13}|\d{9}[\dX])$/i.test(s)) return s
  }
  return null
}

// What you'd pay: Platekompaniet's active_price, then a sale price, then the regular price.
function algoliaPrice(hit: any): number | null {
  for (const v of [hit?.active_price, hit?.price_on_sale?.NOK?.default, hit?.price?.NOK?.default]) {
    if (typeof v === 'number' && isFinite(v) && v >= 0) return v
  }
  return null
}

// Edition/format text from an Algolia hit (Norli: sub_title, format; Platekompaniet:
// formatsdisplay, format_media, book_binding, edition). A format of "Pocket" is a Norwegian
// paperback — spelled out as "pocketbok" so edition.ts doesn't have to treat the bare word
// "pocket" (Pocket Monsters...) as one.
function algoliaEdition(hit: any): string | null {
  const parts: string[] = []
  for (const k of ['sub_title', 'format', 'formatsdisplay', 'format_media', 'book_binding', 'edition']) {
    for (const v of [].concat(hit?.[k] ?? [])) {
      if (typeof v === 'string' && v.trim()) parts.push(/^pocket$/i.test(v.trim()) ? 'pocketbok' : v.trim())
    }
  }
  return parts.length ? parts.join(' ') : null
}

// An Algolia multi-query response -> candidates from the first query that found anything
// (queries are sent JAN/ISBN first). null = not an Algolia response; [] = no hits at all.
export function algoliaCandidates(body: string, fixUrl: (url: string) => string = (u) => u): StoreCandidate[] | null {
  let data: any
  try { data = JSON.parse(body) } catch { return null }
  if (!Array.isArray(data?.results)) return null
  const hits = data.results.find((r: any) => Array.isArray(r?.hits) && r.hits.length)?.hits || []
  return hits
    .filter((h: any) => typeof h?.url === 'string' && h.url.startsWith('https://'))
    .map((h: any) => ({
      url: fixUrl(h.url),
      name: typeof h.name === 'string' ? h.name : null,
      code: algoliaCode(h),
      price: algoliaPrice(h),
      inStock: h.in_stock === 1 || h.in_stock === true ? true : h.in_stock === 0 || h.in_stock === false ? false : null,
      edition: algoliaEdition(h),
    }))
}

// One request for all queries (Algolia's multi-query endpoint).
async function algoliaSearch(
  cfg: { appId: string; index: string },
  apiKey: string,
  queries: string[],
  ctx: SearchContext,
  fixUrl?: (url: string) => string
): Promise<SearchOutcome> {
  const ms = ctx.timeout(SEARCH_TIMEOUT_MS)
  if (ms < MIN_FETCH_MS) return { ok: false, reason: 'out of time' }
  const res = await ctx.fetchPage(`https://${cfg.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`, ms, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Algolia-Application-Id': cfg.appId, 'X-Algolia-API-Key': apiKey },
    body: JSON.stringify({ requests: queries.map((q) => ({ indexName: cfg.index, params: `hitsPerPage=${ALGOLIA_HITS_PER_QUERY}&query=${encodeURIComponent(q)}` })) }),
  })
  if (!res.ok) return { ok: false, reason: res.reason }
  const candidates = algoliaCandidates(res.html, fixUrl)
  return candidates === null ? { ok: false, reason: 'layout not recognized' } : { ok: true, candidates }
}

async function platekompanietSearch(queries: string[], ctx: SearchContext): Promise<SearchOutcome> {
  return algoliaSearch(ALGOLIA_STORES.Platekompaniet, ALGOLIA_STORES.Platekompaniet.apiKey, queries, ctx)
}

// Norli's hits link to checkout.norli.no, which just redirects to the same path on www.
const norliUrl = (url: string) => url.replace(/^https:\/\/checkout\.norli\.no\//, 'https://www.norli.no/')

async function norliSearch(queries: string[], ctx: SearchContext): Promise<SearchOutcome> {
  const cfg = ALGOLIA_STORES.Norli
  const ms = ctx.timeout(SEARCH_TIMEOUT_MS)
  if (ms < MIN_FETCH_MS) return { ok: false, reason: 'out of time' }
  const keyRes = await ctx.fetchPage(cfg.keyUrl, ms, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ operationName: 'createAlgoliaKey', variables: { userToken: '' }, query: NORLI_KEY_MUTATION }),
  })
  if (!keyRes.ok) return { ok: false, reason: `search key: ${keyRes.reason}` }
  let key: unknown
  try { key = JSON.parse(keyRes.html)?.data?.createAlgoliaKey } catch {}
  if (typeof key !== 'string' || !key) return { ok: false, reason: 'search key: not in the response' }
  return algoliaSearch(cfg, key, queries, ctx, norliUrl)
}

// Any store without its own rule: same-host links that look like product pages.
const PRODUCT_PATH = /\/(p|product|products|produkt|produkter|vare|varer|boker|bok|item)\/[^/?#]+|-\d{8,14}\/?$/i
export function genericCandidates(html: string, pageUrl: string): StoreCandidate[] | null {
  let base: URL
  try { base = new URL(pageUrl) } catch { return null }
  const host = base.hostname.replace(/^www\./, '')
  const urls = new Set<string>()
  for (const m of html.matchAll(/href="([^"#]+)"/g)) {
    let u: URL
    try { u = new URL(decodeEntities(m[1]), base) } catch { continue }
    if (u.hostname.replace(/^www\./, '') !== host || u.protocol !== 'https:') continue
    if (!PRODUCT_PATH.test(u.pathname)) continue
    urls.add(u.origin + u.pathname)
  }
  return urls.size ? [...urls].map((url) => ({ url })) : null
}

export const STORE_RULES: Record<string, StoreRule> = {
  Outland: { searchUrl: (q) => 'https://www.outland.no/search/' + encodeURIComponent(q), candidates: outlandCandidates },
  Komplett: { candidates: komplettCandidates },
  Tanum: { candidates: cappelenDammCandidates },
  Power: {
    // The same request power.no's own search page makes (October 2026).
    searchUrl: (q) => `https://www.power.no/api/v2/productlists?size=36&q=${encodeURIComponent(q)}&s=5&from=0&o=false&cd=false`,
    candidates: powerCandidates,
    searchBy: 'name',
  },
  Platekompaniet: { search: platekompanietSearch },
  Norli: { search: norliSearch },
}

export function storeSearchUrl(store: string, query: string): string | null {
  const rule = STORE_RULES[store]
  if (rule?.searchUrl) return rule.searchUrl(query)
  const base = NORWAY_STORE_SITES[store]?.searchUrl
  return base ? base + encodeURIComponent(query) : null
}

export function storeCandidates(store: string, html: string, pageUrl: string): StoreCandidate[] | null {
  return (STORE_RULES[store]?.candidates || genericCandidates)(html, pageUrl)
}

// --- matching -----------------------------------------------------------------------------

export type LookupProduct = { productName: string; productNameJp?: string; jan?: string }

// A searched name appearing in the store's title (rank 0 or 1) counts; a store title that's
// only a fragment of the searched name (rank 2 — e.g. "Final Fantasy XVI" for "Art of Final
// Fantasy XVI") is too weak, as is no overlap at all.
function strongNameMatch(product: LookupProduct, name: string | null | undefined): boolean {
  if (!name) return false
  return [searchName(product.productName), product.productNameJp].some((n) => {
    const rank = n ? compareNames(n, name) : null
    return rank === 0 || rank === 1
  })
}

// Which search hits to open, best first, at most MAX_PRODUCTS_PER_STORE: the same code
// first; a hit with a DIFFERENT code is another edition and is dropped; a hit whose name is
// known but doesn't match — or names another edition (lib/edition.ts) — is dropped, so the
// three slots aren't spent on a paperback when the illustrated edition is wanted; a hit with
// no name or code is kept, in the store's order.
export function rankCandidates(candidates: StoreCandidate[], product: LookupProduct): StoreCandidate[] {
  const want = normalizeCode(product.jan)
  const scored: { c: StoreCandidate; score: number }[] = []
  for (const c of candidates) {
    const got = normalizeCode(c.code)
    if (want && got) { if (got === want) scored.push({ c, score: 0 }); continue }
    if (c.name) {
      if (strongNameMatch(product, c.name) && !editionConflict(product.productName, [c.name, c.edition].filter(Boolean).join(' '))) scored.push({ c, score: 1 })
      continue
    }
    scored.push({ c, score: 2 })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, MAX_PRODUCTS_PER_STORE).map((s) => s.c)
}

// After reading the product page: 'code' when the page's GTIN/ISBN equals the searched one
// (a sure match — the code settles the edition), 'name' on a strong name match when one side
// has no code and the page's name/format don't name another edition, otherwise null.
export function judgeMatch(identity: { name: string | null; gtin: string | null; format?: string | null }, product: LookupProduct): 'code' | 'name' | null {
  const want = normalizeCode(product.jan)
  const got = normalizeCode(identity.gtin)
  if (want && got) return want === got ? 'code' : null
  if (!strongNameMatch(product, identity.name)) return null
  return editionConflict(product.productName, [identity.name, identity.format].filter(Boolean).join(' ')) ? null : 'name'
}

// --- lookup -------------------------------------------------------------------------------

export type DirectResult = {
  store: string
  price: number
  currency: string
  url: string
  inStock: boolean | null
  availability?: Availability
  // true = price read from the product page itself; 'store-search' = from the store's own
  // search data (Platekompaniet/Norli, whose product pages have no structured price).
  verified: true | 'store-search'
  matchedBy: 'code' | 'name'
  direct: true
  note?: string
}

async function lookupStore(
  store: string,
  product: LookupProduct,
  fetchPage: FetchHtml,
  deadline: number,
  now: () => number
): Promise<{ results: DirectResult[]; outcome: StoreOutcome }> {
  const label = NORWAY_STORE_SITES[store]?.label || store
  const timeout = (max: number) => Math.min(max, deadline - now())
  const fail = (reason: string) => ({ results: [], outcome: { store: label, found: 0, reason } })

  // JAN/ISBN first (exact), then the name if that finds nothing at this store.
  const name = searchName(product.productName)
  const rule = STORE_RULES[store]
  const queries = rule?.searchBy === 'name' ? [name] : [...new Set([product.jan, name].filter((q): q is string => !!q))]
  let picked: StoreCandidate[] = []
  if (rule?.search) {
    const found = await rule.search(queries, { fetchPage, timeout })
    if (!found.ok) return fail(found.reason)
    picked = rankCandidates(found.candidates, product)
  }
  for (const q of rule?.search ? [] : queries) {
    const url = storeSearchUrl(store, q)
    if (!url) return fail('no search URL')
    const ms = timeout(SEARCH_TIMEOUT_MS)
    if (ms < MIN_FETCH_MS) return fail('out of time')
    const page = await fetchPage(url, ms)
    if (!page.ok) return fail(page.reason)
    const candidates = storeCandidates(store, page.html, url)
    if (candidates === null) return fail('layout not recognized')
    picked = rankCandidates(candidates, product)
    if (picked.length) break
  }

  const checked = await Promise.all(
    picked.map(async (c): Promise<DirectResult | null> => {
      // The product page is always tried: a price on the page itself wins.
      const ms = timeout(PRODUCT_TIMEOUT_MS)
      const page = ms >= MIN_FETCH_MS ? await fetchPage(c.url, ms) : null
      const pagePrice = page?.ok ? extractPagePrice(page.html) : null
      if (pagePrice && (!pagePrice.currency || pagePrice.currency === 'NOK')) {
        const identity = extractProductIdentity(page!.ok ? page!.html : '')
        // The page's own name/code first; the search data's where the page has none.
        const matchedBy = judgeMatch(
          { name: identity.name || c.name || null, gtin: identity.gtin || c.code || null, format: [identity.format, c.edition].filter(Boolean).join(' ') || null },
          product
        )
        if (!matchedBy) return null
        const a = pagePrice.availability
        return {
          store: label,
          price: pagePrice.price,
          currency: 'NOK',
          url: c.url,
          inStock: a === 'InStock' ? true : a === 'OutOfStock' ? false : c.inStock ?? null,
          ...(a ? { availability: a } : {}),
          verified: true,
          matchedBy,
          direct: true,
        }
      }
      // No price on the page: only a store whose search data has one can still give a result.
      if (typeof c.price !== 'number') return null
      const matchedBy = judgeMatch({ name: c.name || null, gtin: c.code || null, format: c.edition || null }, product)
      if (!matchedBy) return null
      return { store: label, price: c.price, currency: 'NOK', url: c.url, inStock: c.inStock ?? null, verified: 'store-search', matchedBy, direct: true }
    })
  )
  const all = checked.filter((r): r is DirectResult => !!r)
  // A sure (same code) match at this store makes its name-only matches redundant at best and
  // other editions at worst.
  const results = all.some((r) => r.matchedBy === 'code') ? all.filter((r) => r.matchedBy === 'code') : all
  return { results, outcome: { store: label, found: results.length } }
}

// All the category's Norwegian stores in parallel. Never throws: a store that fails is
// reported in `stores` with its reason and contributes no results.
export async function lookupNorwayStores(
  category: string,
  product: LookupProduct,
  options: { fetchPage?: FetchHtml; deadline: number; now?: () => number }
): Promise<{ results: DirectResult[]; stores: StoreOutcome[] }> {
  const fetchPage = options.fetchPage || fetchHtml
  const now = options.now || Date.now
  const stores = norwayStoresFor(category).filter((s) => NORWAY_STORE_SITES[s]?.searchUrl || STORE_RULES[s]?.searchUrl)
  const all = await Promise.all(
    stores.map((s) => lookupStore(s, product, fetchPage, options.deadline, now).catch(() => ({ results: [], outcome: { store: s, found: 0, reason: 'error' } })))
  )
  return { results: all.flatMap((a) => a.results), stores: all.map((a) => a.outcome) }
}

// --- merging with the AI results ----------------------------------------------------------

function urlKey(url: string): string {
  try {
    const u = new URL(url)
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase()
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return url }
}

export const MAX_MERGED_RESULTS = 10

// "Elkjøp", "elkjop.no" and "Elkjop" all give "elkjop"; a trailing ".no"/".com" is dropped.
function shopKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/\.(no|com)$/, '')
    .replace(/[^a-z0-9]+/g, '')
}

// Sure (same GTIN/ISBN) matches first — direct or AI — then AI results whose page couldn't
// be read, then name-only matches ("check the edition"), and Finn's used listings last of
// all: a private seller's ad is never ranked with a shop's price. One entry per product page
// (the direct one wins — it's verified and knows how it matched), and a store with a sure
// match loses its name-only matches. A Prisjakt offer ("<shop> via Prisjakt") is dropped when
// that shop already has a result of its own (its own page beats Prisjakt's copy of the
// price), and only the first offer per shop is kept.
export function mergeFindPricesResults<A extends { url: string; store?: string; matchedBy?: 'code' | 'name'; source?: 'prisjakt' | 'finn'; shop?: string }>(
  ai: A[],
  direct: DirectResult[]
): (A | DirectResult)[] {
  const directKeys = new Set(direct.map((d) => urlKey(d.url)))
  const all: (A | DirectResult)[] = [...direct, ...ai.filter((a) => !directKeys.has(urlKey(a.url)))]
  const sureHosts = new Set(all.filter((r) => r.matchedBy === 'code').map((r) => hostOf(r.url)))
  // A shop's own results, by their store name and by their site (outland.no -> "outland").
  const ownShops = new Set(
    all.filter((r) => !('source' in r && r.source)).flatMap((r) => [r.store ? shopKey(r.store) : '', shopKey(hostOf(r.url).split('.')[0])]).filter(Boolean)
  )
  const viaShops = new Set<string>()
  const kept = all.filter((r) => {
    if (r.matchedBy === 'name' && sureHosts.has(hostOf(r.url))) return false
    if (!('source' in r) || r.source !== 'prisjakt' || !r.shop) return true
    const key = shopKey(r.shop)
    if (ownShops.has(key) || viaShops.has(key)) return false
    viaShops.add(key)
    return true
  })
  const rank = (r: A | DirectResult) =>
    'source' in r && r.source === 'finn' ? 3 : r.matchedBy === 'code' ? 0 : r.matchedBy === 'name' ? 2 : 1
  const ordered = kept.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r)
  // One Prisjakt page carries several shops' offers, so its URL alone doesn't identify a result.
  const key = (r: A | DirectResult) => urlKey(r.url) + ('source' in r && r.source === 'prisjakt' && r.shop ? '#' + shopKey(r.shop) : '')
  const seen = new Set<string>()
  return ordered.filter((r) => !seen.has(key(r)) && seen.add(key(r))).slice(0, MAX_MERGED_RESULTS)
}

// An AI result, after its product page was read for the price check: the same code as the
// one searched for makes it a sure match; a different code, or a name/format that names
// another edition, drops it (with the reason, for the diagnostics); otherwise it's a
// name-only match. No identity on the page (blocked, no structured data) -> unknown.
export function checkAiResult(
  identity: { name: string | null; gtin: string | null; format?: string | null } | null,
  product: LookupProduct
): { matchedBy?: 'code' | 'name'; drop?: string } {
  if (!identity || (!identity.name && !identity.gtin)) return {}
  const want = normalizeCode(product.jan)
  const got = normalizeCode(identity.gtin)
  if (want && got) return want === got ? { matchedBy: 'code' } : { drop: 'another edition (different EAN/ISBN)' }
  const conflict = editionConflict(product.productName, [identity.name, identity.format].filter(Boolean).join(' '))
  return conflict ? { drop: `another edition (${conflict})` } : { matchedBy: 'name' }
}
