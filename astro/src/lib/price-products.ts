import { sanity } from './sanity'

export type PriceDoc = {
  _id: string
  productName?: string
  productNameJp?: string
  jan?: string
  category?: string
  image?: { assetId?: string; url?: string } | null
  price?: number
  currency?: string
  sourceType?: string
  shopName?: string
  sourceName?: string
  condition?: string
  status?: string
  seenAt?: string
  note?: string
  buyer?: string
}

export type ProductPrice = {
  _id: string
  source: string
  price: number
  currency: string
  condition?: string
  status?: string
  seenAt?: string
  note?: string
  buyer?: string
}

export type Product = {
  key: string
  productName: string
  productNameJp?: string
  jan?: string
  category?: string
  image: { assetId: string; url: string } | null
  prices: ProductPrice[]
}

// The one grouping key used everywhere a priceEntry needs to be clustered into a
// "product": the JAN if present, otherwise the trimmed/lowercased product name.
// Both add-price.astro and prices.astro must use this exact function so a price
// logged from either page always lands in the same product group.
export function productKey(jan: string | undefined | null, productName: string | undefined | null): string {
  const j = String(jan || '').trim()
  if (j) return j
  return String(productName || '').trim().toLowerCase()
}

export function sourceLabel(d: Pick<PriceDoc, 'sourceType' | 'shopName' | 'sourceName'>): string {
  return d.sourceType === 'japanStore'
    ? d.shopName || 'Shop'
    : d.sourceName || (d.sourceType === 'norway' ? 'Norway' : 'Online')
}

const PRICE_DOCS_QUERY = `
  *[_type == "priceEntry" && !(_id in path("drafts.**"))] | order(seenAt desc) {
    _id, productName, productNameJp, jan, category,
    "image": image{ "assetId": asset->_id, "url": asset->url },
    price, currency, sourceType,
    "shopName": shop->shopName,
    sourceName, condition, status, seenAt, note, buyer
  }
`

// Groups raw priceEntry docs (already newest-first) into products. The first time a
// key is seen is therefore its most recent entry — that entry's productName/
// productNameJp/jan/category/image become the product's. All occurrences (including
// that first one) accumulate into `.prices`, staying in the same most-recent-first order.
export function groupProducts(docs: PriceDoc[]): Product[] {
  const productMap = new Map<string, Product>()
  for (const d of docs) {
    const name = String(d.productName || '').trim()
    if (!name) continue
    const jan = String(d.jan || '').trim()
    const key = productKey(jan, name)
    const priceRow: ProductPrice = {
      _id: d._id,
      source: sourceLabel(d),
      price: d.price ?? 0,
      currency: d.currency || 'JPY',
      condition: d.condition,
      status: d.status,
      seenAt: d.seenAt,
      note: d.note,
      buyer: d.buyer,
    }

    let product = productMap.get(key)
    if (!product) {
      product = {
        key,
        productName: name,
        productNameJp: d.productNameJp || undefined,
        jan: jan || undefined,
        category: d.category || undefined,
        image: d.image && d.image.assetId && d.image.url ? { assetId: d.image.assetId, url: d.image.url } : null,
        prices: [],
      }
      productMap.set(key, product)
    }
    product.prices.push(priceRow)
  }
  return [...productMap.values()].sort((a, b) => a.productName.localeCompare(b.productName))
}

export async function fetchProducts(): Promise<Product[]> {
  const docs: PriceDoc[] = await sanity.fetch(PRICE_DOCS_QUERY)
  return groupProducts(docs)
}

export type TripOption = { _id: string; label?: string; people: string[] }

// Trips for the buyer/trip pickers on add-price.astro and edit-price.astro. `people` is
// the flattened list of names with a budget line on that trip (from childBudgets), used
// to filter the trip select down to trips valid for the currently chosen buyer — the
// same rule Studio applies when offering trips on a familyPurchase.
export async function fetchTrips(): Promise<TripOption[]> {
  const raw: { _id: string; label?: string; childBudgets?: { person?: string }[] }[] = await sanity.fetch(
    `*[_type == "tripSettings"] | order(_createdAt asc) { _id, label, childBudgets[]{ person } }`
  )
  return raw.map((t) => ({
    _id: t._id,
    label: t.label,
    people: (t.childBudgets || []).map((c) => c.person).filter((p): p is string => !!p),
  }))
}

export type ShopOption = { _id: string; shopName: string }
export type ShopGroup = { area: string; shops: ShopOption[] }

// The shop dropdown used by both add-price.astro and edit-price.astro: real shops only
// (restaurants/sights/etc. filtered out), grouped and sorted by area.
export async function fetchShopGroups(): Promise<ShopGroup[]> {
  const shopsRaw: { _id: string; shopName: string; area?: string }[] = await sanity.fetch(`
    *[_type == "shopNote" && !(_id in path("drafts.**")) && (placeType == "shop" || !defined(placeType))]
      | order(area asc, shopName asc) { _id, shopName, area }
  `)

  const byArea = new Map<string, ShopOption[]>()
  for (const s of shopsRaw) {
    const area = s.area || 'Other'
    if (!byArea.has(area)) byArea.set(area, [])
    byArea.get(area)!.push({ _id: s._id, shopName: s.shopName })
  }
  return [...byArea.keys()].sort().map((area) => ({ area, shops: byArea.get(area)! }))
}
