// "Found here": what has been seen or bought at a shop — its price entries (priceEntry.shop)
// and the family purchases from that store (familyPurchase.store) that weren't made from a
// price entry (a price marked bought creates its familyPurchase, which would otherwise show
// twice). Used by the shop's edit page (the full list) and the shop list (/notes: a row of
// thumbnails). Pure functions plus the GROQ projections both pages fetch with.
import { productKey } from './product-key'

// The price entries at a shop: `filter` picks the shop(s), e.g. `shop._ref == $id`.
export const foundPricesQuery = (filter: string) => `
  *[_type == "priceEntry" && !(_id in path("drafts.**")) && ${filter}] {
    _id, productName, jan, price, currency, status, seenAt, _createdAt,
    "shopId": shop._ref,
    "imageUrl": image.asset->url
  }`

// The family purchases from a store, without those made from a price entry.
export const foundPurchasesQuery = (filter: string) => `
  *[_type == "familyPurchase" && !(_id in path("drafts.**")) && ${filter}
    && !(_id in *[_type == "priceEntry" && defined(createdFamilyPurchase)].createdFamilyPurchase._ref)] {
    _id, name, status, priceYen, priceNok, purchaseDate, _createdAt,
    "shopId": store._ref,
    "imageUrl": photos[0].asset->url
  }`

export type FoundPriceDoc = {
  _id: string
  productName?: string | null
  jan?: string | null
  price?: number | null
  currency?: string | null
  status?: string | null
  seenAt?: string | null
  _createdAt?: string | null
  shopId?: string | null
  imageUrl?: string | null
}

export type FoundPurchaseDoc = {
  _id: string
  name?: string | null
  status?: string | null
  priceYen?: number | null
  priceNok?: number | null
  purchaseDate?: string | null
  _createdAt?: string | null
  shopId?: string | null
  imageUrl?: string | null
}

export type FoundItem = {
  kind: 'price' | 'purchase'
  id: string
  name: string
  imageUrl: string | null
  price: number | null
  currency: string
  // A price is "considering" or "bought"; a family purchase "planned" or "bought" — only
  // "bought" counts as bought, as on /spending.
  status: 'considering' | 'planned' | 'bought'
  date: string // ISO date or date-time ('' if none)
  href: string | null // a price opens /edit-price; a family purchase has no page of its own
  productKey: string // the same product grouping as /prices (price-products.ts productKey)
}

// Newest first: a price by when it was seen, a purchase by its date (both fall back to when
// the document was made).
export function foundItems(prices: FoundPriceDoc[], purchases: FoundPurchaseDoc[]): FoundItem[] {
  const items: FoundItem[] = []
  for (const p of prices) {
    const name = String(p.productName || '').trim()
    if (!name) continue
    items.push({
      kind: 'price',
      id: p._id,
      name,
      imageUrl: p.imageUrl || null,
      price: typeof p.price === 'number' ? p.price : null,
      currency: p.currency || 'JPY',
      status: p.status === 'bought' ? 'bought' : 'considering',
      date: p.seenAt || p._createdAt || '',
      href: `/edit-price?id=${encodeURIComponent(p._id)}`,
      productKey: productKey(p.jan, name),
    })
  }
  for (const f of purchases) {
    const name = String(f.name || '').trim()
    if (!name) continue
    const yen = typeof f.priceYen === 'number' ? f.priceYen : null
    const nok = typeof f.priceNok === 'number' ? f.priceNok : null
    items.push({
      kind: 'purchase',
      id: f._id,
      name,
      imageUrl: f.imageUrl || null,
      price: yen ?? nok,
      currency: yen != null ? 'JPY' : 'NOK',
      status: f.status === 'bought' ? 'bought' : 'planned',
      date: f.purchaseDate || f._createdAt || '',
      href: null,
      productKey: `purchase:${f._id}`,
    })
  }
  return items.sort((a, b) => sortKey(b.date).localeCompare(sortKey(a.date)))
}

// A date-only "2026-12-03" sorts as the start of that day against full date-times.
const sortKey = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : d)

// The shop list's thumbnail row: one item per product (its newest price) and per family
// purchase, newest first — the first `max` shown, "+N" for the rest.
export function foundThumbs(items: FoundItem[], max = 4): { thumbs: FoundItem[]; more: number } {
  const seen = new Set<string>()
  const products = items.filter((i) => (seen.has(i.productKey) ? false : (seen.add(i.productKey), true)))
  return { thumbs: products.slice(0, max), more: Math.max(0, products.length - max) }
}

// "Nov 3, 2026" — like /prices' dates. A date-only value is that calendar day, whatever the
// server's time zone.
export function formatFoundDate(iso: string): string {
  if (!iso) return ''
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) })
}
