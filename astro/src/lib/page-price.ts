// Reads the price a store's product page actually shows, from its structured data — used by
// /api/find-prices to check each search result against the live page, because the model's
// price comes from the search index and can be stale (Outland's Flareon plush: search said
// 349 kr, the page itself said 279 kr everywhere). Pure functions only — no fetching here —
// so they can be tested with saved HTML.

export type Availability = 'InStock' | 'OutOfStock' | 'PreOrder' | 'BackOrder'

export type PagePrice = {
  price: number
  currency: string | null
  availability: Availability | null
  source: 'json-ld' | 'meta' | 'microdata'
}

const AVAILABILITY: Record<string, Availability> = {
  instock: 'InStock',
  outofstock: 'OutOfStock',
  soldout: 'OutOfStock',
  preorder: 'PreOrder',
  backorder: 'BackOrder',
}

// "https://schema.org/InStock", "InStock", "in stock", "out_of_stock" -> the four values the
// UI knows; anything else (LimitedAvailability, Discontinued, ...) -> null.
function parseAvailability(value: unknown): Availability | null {
  if (typeof value !== 'string') return null
  const key = value.split('/').pop()!.toLowerCase().replace(/[\s_-]/g, '')
  return AVAILABILITY[key] || null
}

// 279, "279", "279.00", "1 299,00", "1.299,00" -> a number; anything else -> null.
function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return isFinite(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  let s = value.replace(/[\s ]/g, '').replace(/[^\d.,]/g, '')
  if (!s) return null
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.299,00 / 279,00
  else s = s.replace(/,/g, '') // 1,299.00
  const n = Number(s)
  return isFinite(n) && n >= 0 ? n : null
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null
}

// --- JSON-LD -----------------------------------------------------------------------------

function isType(node: any, type: string): boolean {
  const t = node?.['@type']
  return Array.isArray(t) ? t.includes(type) : t === type
}

// Every object in a JSON-LD value, depth-first (handles top-level arrays, @graph, and a
// Product nested inside e.g. a WebPage's mainEntity).
function* walk(node: any): Generator<any> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return }
  if (!node || typeof node !== 'object') return
  yield node
  for (const v of Object.values(node)) if (v && typeof v === 'object') yield* walk(v)
}

function fromOffer(offer: any): Omit<PagePrice, 'source'> | null {
  if (!offer || typeof offer !== 'object') return null
  // A plain Offer's `price` is what you pay now (a list/regular price, if given at all, sits
  // in priceSpecification); an AggregateOffer has lowPrice/highPrice instead.
  const price = parsePrice(offer.price) ?? parsePrice(offer.lowPrice) ?? parsePrice(offer.priceSpecification?.price)
  if (price === null) return null
  const currency = offer.priceCurrency || offer.priceSpecification?.priceCurrency
  return { price, currency: typeof currency === 'string' ? currency.toUpperCase() : null, availability: parseAvailability(offer.availability) }
}

function fromJsonLd(html: string): PagePrice | null {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    let data: any
    try { data = JSON.parse(m[1].trim()) } catch { continue }
    for (const node of walk(data)) {
      if (!isType(node, 'Product') && !isType(node, 'ProductGroup')) continue
      const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []
      for (const offer of offers) {
        const found = fromOffer(offer)
        if (found) return { ...found, source: 'json-ld' }
      }
    }
  }
  return null
}

// --- meta tags (Open Graph / Facebook product tags) ---------------------------------------

function fromMeta(html: string): PagePrice | null {
  const meta = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase()
    const content = attr(tag, 'content')
    if (key && content !== null && !meta.has(key)) meta.set(key, content)
  }
  // A sale price is what you'd actually pay; the plain price tag may be the regular price.
  const price =
    parsePrice(meta.get('product:sale_price:amount')) ??
    parsePrice(meta.get('product:price:amount')) ??
    parsePrice(meta.get('og:price:amount'))
  if (price === null) return null
  const currency =
    meta.get('product:sale_price:currency') || meta.get('product:price:currency') || meta.get('og:price:currency') || null
  const availability = parseAvailability(meta.get('product:availability') ?? meta.get('og:availability'))
  return { price, currency: currency ? currency.toUpperCase() : null, availability, source: 'meta' }
}

// --- microdata ----------------------------------------------------------------------------

function itempropValue(html: string, prop: string): string | null {
  const tag = html.match(new RegExp(`<[^>]*\\bitemprop\\s*=\\s*["']${prop}["'][^>]*>`, 'i'))
  if (!tag) return null
  const fromAttr = attr(tag[0], 'content') ?? attr(tag[0], 'href')
  if (fromAttr !== null) return fromAttr
  // <span itemprop="price">279,00</span> — the element's own text.
  const after = html.slice(html.indexOf(tag[0]) + tag[0].length)
  const text = after.match(/^([^<]*)/)
  return text ? decodeEntities(text[1].trim()) : null
}

function fromMicrodata(html: string): PagePrice | null {
  const price = parsePrice(itempropValue(html, 'price')) ?? parsePrice(itempropValue(html, 'lowPrice'))
  if (price === null) return null
  const currency = itempropValue(html, 'priceCurrency')
  return { price, currency: currency ? currency.toUpperCase() : null, availability: parseAvailability(itempropValue(html, 'availability')), source: 'microdata' }
}

// JSON-LD offers first, then meta tags, then microdata — the first source with a price wins.
// A source with a price but no availability borrows availability from a later one.
export function extractPagePrice(html: string): PagePrice | null {
  const sources = [fromJsonLd(html), fromMeta(html), fromMicrodata(html)]
  const first = sources.find((s): s is PagePrice => !!s)
  if (!first) return null
  return {
    ...first,
    currency: first.currency ?? sources.find((s) => s?.currency)?.currency ?? null,
    availability: first.availability ?? sources.find((s) => s?.availability)?.availability ?? null,
  }
}

// --- merging a page reading into a search result ------------------------------------------

export type CheckedPrice<T> = T & {
  verified: boolean
  searchPrice?: number
  searchCurrency?: string
  availability?: Availability
}

// The page's price replaces the model's when it's usable: a known currency, and NOK for a
// Norway search (same rule find-prices-results.ts applies to the model's own answer). If the
// two differ, the model's value is kept as searchPrice/searchCurrency so the UI can say so.
// Structured availability replaces the model's in-stock guess. No usable page price -> the
// model's result unchanged, marked unverified.
export function applyPagePrice<T extends { price: number; currency: string; inStock: boolean | null }>(
  result: T,
  page: PagePrice | null,
  region: string,
  allowedCurrencies: string[]
): CheckedPrice<T> {
  const currency = page?.currency || result.currency
  const usable = !!page && allowedCurrencies.includes(currency) && (region !== 'norway' || currency === 'NOK')
  const withAvailability = (r: T): T =>
    page?.availability
      ? { ...r, inStock: page.availability === 'InStock' ? true : page.availability === 'OutOfStock' ? false : null }
      : r
  if (!usable) return { ...withAvailability(result), verified: false, ...(page?.availability ? { availability: page.availability } : {}) }

  const checked: CheckedPrice<T> = { ...withAvailability(result), price: page!.price, currency, verified: true }
  if (page!.availability) checked.availability = page!.availability
  if (page!.price !== result.price || currency !== result.currency) {
    checked.searchPrice = result.price
    checked.searchCurrency = result.currency
  }
  return checked
}
