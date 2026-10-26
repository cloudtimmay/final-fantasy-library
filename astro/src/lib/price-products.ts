import { sanity } from './sanity'
import { OWNER } from './price-entry-fields'
import type { OwnedItem, CollectionItem } from './product-match'

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

// The owner's whole collection in the minimal shape findCollectionMatches() (src/lib/
// product-match.ts) needs — a few hundred small rows, matched in JS rather than with GROQ
// `match`, which needs every word of the identified name to appear in the stored title.
export async function fetchCollectionForMatching(): Promise<CollectionItem[]> {
  return sanity.fetch(
    `*[_type in ["album", "game", "book", "figure"] && !(_id in path("drafts.**"))]{ _id, _type, title, barcode, isbn, status }`
  )
}

// Everything a family member already has, from the three places that can record it — plus the
// owner's (OWNER/Kim) "other things": their familyItems, the non-Final-Fantasy things they own.
// The owner's Final Fantasy items are the collection itself (checked separately, see
// fetchCollectionForMatching()), so for them only familyItems count here, not purchases. Sources: a familyItem logged directly, a
// bought familyPurchase (name + barcode only — it has no separate Japanese name), or a
// priceEntry marked "bought" for that buyer (which may or may not also have created a
// familyPurchase — see add-price.astro's "Bought without a trip" case). Normalized into one
// flat list so findOwnersOf() (src/lib/product-match.ts) never needs to know which of the
// three a given record came from.
export async function fetchOwnedByPerson(): Promise<OwnedItem[]> {
  const familyItemsQuery: Promise<{ _id: string; person: string; name: string; nameJp?: string; jan?: string }[]> = sanity.fetch(
    `*[_type == "familyItem" && !(_id in path("drafts.**"))]{ _id, person, name, nameJp, jan }`
  )
  const familyPurchasesQuery: Promise<{ person: string; name: string; barcode?: string }[]> = sanity.fetch(
    `*[_type == "familyPurchase" && status == "bought" && person != $owner]{ person, name, barcode }`,
    { owner: OWNER }
  )
  const boughtEntriesQuery: Promise<{ person: string; productName: string; productNameJp?: string; jan?: string }[]> = sanity.fetch(
    `*[_type == "priceEntry" && status == "bought" && defined(buyer) && buyer != $owner]
      { "person": buyer, productName, productNameJp, jan }`,
    { owner: OWNER }
  )
  const [familyItems, familyPurchases, boughtEntries] = await Promise.all([familyItemsQuery, familyPurchasesQuery, boughtEntriesQuery])

  return [
    ...familyItems.map((i) => ({ person: i.person, name: i.name, nameJp: i.nameJp, jan: i.jan, familyItemId: i._id })),
    ...familyPurchases.map((p) => ({ person: p.person, name: p.name, jan: p.barcode })),
    ...boughtEntries.map((e) => ({ person: e.person, name: e.productName, nameJp: e.productNameJp, jan: e.jan })),
  ]
}

// One thing a family member owns, as /family lists it — the same three sources (and the same
// filters) as fetchOwnedByPerson() above, with what a row needs to show:
// - 'familyItem': logged directly; the only kind editable on /family.
// - 'familyPurchase': bought on a trip ("Bought in Japan" + the trip's label). It has no photo,
//   category, Japanese name or note of its own, so those come from the price entry that
//   created it (priceEntry.createdFamilyPurchase), if there is one.
// - 'priceEntry': marked bought for this buyer without a trip, so no familyPurchase exists.
//   A bought entry that did create a (still bought) familyPurchase isn't listed twice.
// For OWNER ("Kim (other)" on /family): only their familyItems — their "other things". A
// purchase of theirs that went to other things created one of those familyItems
// (priceEntry.createdItem), so it is listed once, as that item, with `bought`/`tripLabel` from
// the purchase; their other purchases belong to the Final Fantasy collection, not here.
export type FamilyOwnedRow = {
  kind: 'familyItem' | 'familyPurchase' | 'priceEntry'
  id: string
  name: string
  nameJp?: string
  jan?: string
  category?: string
  note?: string
  imageUrl?: string
  tripLabel?: string
  bought?: boolean
}

export async function fetchFamilyOwned(person: string): Promise<FamilyOwnedRow[]> {
  if (!person) return []
  const notDraft = `!(_id in path("drafts.**"))`
  if (person === OWNER) {
    const items: any[] = await sanity.fetch(
      `*[_type == "familyItem" && person == $person && ${notDraft}]{
        _id, name, nameJp, jan, category, note, "imageUrl": image.asset->url,
        "boughtBy": *[_type == "priceEntry" && status == "bought" && createdItem._ref == ^._id][0]{ "tripLabel": createdFamilyPurchase->trip->label }
      }`,
      { person }
    )
    return items
      .map((i) =>
        cleanRow({
          kind: 'familyItem', id: i._id, name: i.name || '', nameJp: i.nameJp, jan: i.jan, category: i.category, note: i.note, imageUrl: i.imageUrl,
          bought: i.boughtBy ? true : undefined, tripLabel: i.boughtBy?.tripLabel,
        })
      )
      .sort(byName)
  }
  const [items, purchases, entries]: [any[], any[], any[]] = await Promise.all([
    sanity.fetch(
      `*[_type == "familyItem" && person == $person && ${notDraft}]
        { _id, name, nameJp, jan, category, note, "imageUrl": image.asset->url }`,
      { person }
    ),
    sanity.fetch(
      `*[_type == "familyPurchase" && status == "bought" && person == $person && ${notDraft}]{
        _id, name, barcode, "tripLabel": trip->label,
        "entry": *[_type == "priceEntry" && createdFamilyPurchase._ref == ^._id][0]
          { productNameJp, category, note, "imageUrl": image.asset->url }
      }`,
      { person }
    ),
    sanity.fetch(
      `*[_type == "priceEntry" && status == "bought" && buyer == $person && ${notDraft}]
        { _id, productName, productNameJp, jan, category, note, "imageUrl": image.asset->url, "fpId": createdFamilyPurchase._ref }`,
      { person }
    ),
  ])
  const boughtPurchaseIds = new Set(purchases.map((p) => p._id))
  const rows: FamilyOwnedRow[] = [
    ...items.map((i) => cleanRow({ kind: 'familyItem', id: i._id, name: i.name || '', nameJp: i.nameJp, jan: i.jan, category: i.category, note: i.note, imageUrl: i.imageUrl })),
    ...purchases.map((p) =>
      cleanRow({
        kind: 'familyPurchase', id: p._id, name: p.name || '', jan: p.barcode, tripLabel: p.tripLabel,
        nameJp: p.entry?.productNameJp, category: p.entry?.category, note: p.entry?.note, imageUrl: p.entry?.imageUrl,
      })
    ),
    ...entries
      .filter((e) => !(e.fpId && boughtPurchaseIds.has(e.fpId)))
      .map((e) => cleanRow({ kind: 'priceEntry', id: e._id, name: e.productName || '', nameJp: e.productNameJp, jan: e.jan, category: e.category, note: e.note, imageUrl: e.imageUrl })),
  ]
  return rows.sort(byName)
}

const cleanRow = (r: FamilyOwnedRow): FamilyOwnedRow =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== '')) as FamilyOwnedRow
const byName = (a: FamilyOwnedRow, b: FamilyOwnedRow) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
