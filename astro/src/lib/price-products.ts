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
}

export type ProductPrice = {
  _id: string
  source: string
  price: number
  currency: string
  condition?: string
  status?: string
  seenAt?: string
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
    sourceName, condition, status, seenAt
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
