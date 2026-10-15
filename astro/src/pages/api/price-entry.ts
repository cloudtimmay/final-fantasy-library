import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc } from '../../lib/api'
import { CATEGORIES, SOURCE_TYPES, CURRENCIES, CONDITIONS, PEOPLE_LIST } from '../../lib/price-entry-fields'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const productName = String(body.productName || '').trim()
  if (!productName) return json(400, { error: 'Product name is required' })

  const price = Number(body.price)
  if (body.price === '' || body.price == null || isNaN(price) || price < 0) {
    return json(400, { error: 'Price is required and must be 0 or more' })
  }

  if (!CATEGORIES.includes(body.category)) return json(400, { error: 'Category is required' })

  // sourceType and currency are always sent as one of a fixed set of valid values by
  // every caller (a radio group / validated AI search result) — unlike condition, which
  // genuinely has an optional "just use the default" case. Rejecting an invalid value
  // here instead of silently defaulting it (as this used to do) means a client-side bug
  // that sends a bad value surfaces as an error immediately, rather than quietly saving
  // a plausible-looking but wrong document — matching price-entry-update.ts's existing,
  // stricter validation for the same two fields.
  if (!SOURCE_TYPES.includes(body.sourceType)) return json(400, { error: 'Invalid source type' })
  if (!CURRENCIES.includes(body.currency)) return json(400, { error: 'Invalid currency' })
  const sourceType = body.sourceType
  const currency = body.currency
  const condition = CONDITIONS.includes(body.condition) ? body.condition : 'new'

  const base: Record<string, any> = {
    _type: 'priceEntry',
    productName,
    category: body.category,
    sourceType,
    price,
    currency,
    condition,
    // A new entry is always Considering — the Bought transition (and everything it
    // triggers: familyPurchase/collection-item creation) only ever happens through
    // /api/price-entry-update, so that logic lives in exactly one place.
    status: 'considering',
    taxIncluded: typeof body.taxIncluded === 'boolean' ? body.taxIncluded : true,
    seenAt: new Date().toISOString(),
  }

  const buyer = String(body.buyer || '').trim()
  if (buyer) {
    if (!PEOPLE_LIST.includes(buyer)) return json(400, { error: 'Invalid buyer' })
    base.buyer = buyer
  }

  const tripId = String(body.tripId || '').trim()
  if (tripId) {
    const trip = await sanity.fetch(`*[_id == $id && _type == "tripSettings"][0]{ _id }`, { id: tripId })
    if (!trip) return json(400, { error: 'Unknown trip' })
    base.trip = { _type: 'reference', _ref: tripId, _weak: true }
  }

  // Shop vs. sourceName/url are mutually exclusive, gated by sourceType — never trust
  // the client to only send the relevant one.
  if (sourceType === 'japanStore') {
    const shopId = String(body.shopId || '').trim()
    if (shopId) base.shop = { _type: 'reference', _ref: shopId, _weak: true }
  } else {
    const sourceName = String(body.sourceName || '').trim()
    if (sourceName) base.sourceName = sourceName
    const url = String(body.url || '').trim()
    if (url) base.url = url
  }

  // JAN is digits-only; strip anything else (scanner/typed input may include stray chars).
  const jan = String(body.jan || '').replace(/\D/g, '')
  if (jan) base.jan = jan

  // Reuse an existing product's photo when no new one was taken for this entry.
  // Only accept something that actually looks like a Sanity image asset id — this is
  // the one field here that references another document by a client-supplied id, so it
  // gets its own explicit format check rather than just an includes()/trim() guard.
  const imageAssetId = String(body.imageAssetId || '').trim()
  if (imageAssetId && imageAssetId.startsWith('image-')) {
    base.image = { _type: 'image', asset: { _type: 'reference', _ref: imageAssetId } }
  }

  const doc = buildDoc(base, body, [
    { from: 'productNameJp' },
    { from: 'extraCost', type: 'num' },
    { from: 'note' },
  ])

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}
