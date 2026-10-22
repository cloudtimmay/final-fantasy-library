// Direct store lookup for Find prices (Norway): searches each Norwegian store's own site
// server-side, reads the product pages it finds, and keeps the ones that really are the
// product — alongside the AI web search, which only sees what a search engine has indexed.
//
// Which stores work server-side was checked in October 2026 (searching by ISBN, EAN and name):
// - Outland: yes, but only with the query in the PATH (/search/<q>) — /search?q= ignores the
//   query server-side and returns the default listing of all ~82 000 products.
// - Komplett: yes (?q=, also by EAN); results are embedded as JSON (preloadedSearchResult).
// - Cappelen Damm (Tanum): yes (?query=, by ISBN or name); result links end in the ISBN.
// - Power, Norli, Platekompaniet: no — their results are rendered in the browser only.
// - Ark, Elkjøp: no — HTTP 429 (bot protection). CDON, Proshop: no — HTTP 403.
// Stores that fail are tried anyway (in parallel, so it costs no time) and reported in the
// diagnostic line, so a store that starts working again shows up without a code change.
import { NORWAY_STORE_SITES, norwayStoresFor, searchName } from './find-prices-prompt'
import { extractPagePrice, extractProductIdentity, type Availability } from './page-price'
import { compareNames, normalizeCode } from './product-match'
import type { StoreOutcome } from './find-prices-results'

export const SEARCH_TIMEOUT_MS = 6000
export const PRODUCT_TIMEOUT_MS = 5000
export const MAX_PRODUCTS_PER_STORE = 3
const MIN_FETCH_MS = 500
const MAX_PAGE_BYTES = 5 * 1024 * 1024
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export type FetchResult = { ok: true; html: string } | { ok: false; reason: string }
export type FetchHtml = (url: string, timeoutMs: number) => Promise<FetchResult>

// The real fetch, shared with find-prices.ts's page-price check: normal browser headers, a
// hard timeout, and a reason on failure for the diagnostic line.
export const fetchHtml: FetchHtml = async (url, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8' },
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

export type StoreCandidate = { url: string; name?: string | null; code?: string | null }

type StoreRule = {
  // Overrides NORWAY_STORE_SITES[store].searchUrl for server-side searching.
  searchUrl?: (query: string) => string
  // The product links on a search page. null = layout not recognized; [] = no hits.
  candidates?: (html: string, pageUrl: string) => StoreCandidate[] | null
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
  // The unfiltered default listing (the whole catalog) means the query wasn't applied.
  if (typeof products.total_count === 'number' && products.total_count > 10000) return null
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
// known but doesn't match is dropped; a hit with no name or code is kept, in the store's order.
export function rankCandidates(candidates: StoreCandidate[], product: LookupProduct): StoreCandidate[] {
  const want = normalizeCode(product.jan)
  const scored: { c: StoreCandidate; score: number }[] = []
  for (const c of candidates) {
    const got = normalizeCode(c.code)
    if (want && got) { if (got === want) scored.push({ c, score: 0 }); continue }
    if (c.name) { if (strongNameMatch(product, c.name)) scored.push({ c, score: 1 }); continue }
    scored.push({ c, score: 2 })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, MAX_PRODUCTS_PER_STORE).map((s) => s.c)
}

// After reading the product page: 'code' when the page's GTIN/ISBN equals the searched one
// (a sure match), 'name' on a strong name match when one side has no code, otherwise null.
export function judgeMatch(identity: { name: string | null; gtin: string | null }, product: LookupProduct): 'code' | 'name' | null {
  const want = normalizeCode(product.jan)
  const got = normalizeCode(identity.gtin)
  if (want && got) return want === got ? 'code' : null
  return strongNameMatch(product, identity.name) ? 'name' : null
}

// --- lookup -------------------------------------------------------------------------------

export type DirectResult = {
  store: string
  price: number
  currency: string
  url: string
  inStock: boolean | null
  availability?: Availability
  verified: true
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
  const queries = [...new Set([product.jan, name].filter((q): q is string => !!q))]
  let picked: StoreCandidate[] = []
  for (const q of queries) {
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
      const ms = timeout(PRODUCT_TIMEOUT_MS)
      if (ms < MIN_FETCH_MS) return null
      const page = await fetchPage(c.url, ms)
      if (!page.ok) return null
      const price = extractPagePrice(page.html)
      if (!price || (price.currency && price.currency !== 'NOK')) return null
      const matchedBy = judgeMatch(extractProductIdentity(page.html), product)
      if (!matchedBy) return null
      const a = price.availability
      return {
        store: label,
        price: price.price,
        currency: 'NOK',
        url: c.url,
        inStock: a === 'InStock' ? true : a === 'OutOfStock' ? false : null,
        ...(a ? { availability: a } : {}),
        verified: true,
        matchedBy,
        direct: true,
      }
    })
  )
  const results = checked.filter((r): r is DirectResult => !!r)
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

export const MAX_MERGED_RESULTS = 10

// Sure (same GTIN/ISBN) direct matches first, then the AI results, then direct name matches;
// one entry per product page (the direct one wins — it's verified and knows how it matched).
export function mergeFindPricesResults<A extends { url: string }>(ai: A[], direct: DirectResult[]): (A | DirectResult)[] {
  const directKeys = new Set(direct.map((d) => urlKey(d.url)))
  const ordered = [
    ...direct.filter((d) => d.matchedBy === 'code'),
    ...ai.filter((a) => !directKeys.has(urlKey(a.url))),
    ...direct.filter((d) => d.matchedBy === 'name'),
  ]
  const seen = new Set<string>()
  return ordered.filter((r) => !seen.has(urlKey(r.url)) && seen.add(urlKey(r.url))).slice(0, MAX_MERGED_RESULTS)
}
