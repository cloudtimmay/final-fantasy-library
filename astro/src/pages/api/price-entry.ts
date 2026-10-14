import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc } from '../../lib/api'

export const prerender = false

const CATEGORIES = ['album', 'game', 'book', 'figure', 'other']
const SOURCE_TYPES = ['japanStore', 'online', 'norway']
const CURRENCIES = ['JPY', 'NOK', 'USD', 'EUR']
const CONDITIONS = ['new', 'used', 'used_complete']
const STATUSES = ['considering', 'bought']

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

  const sourceType = SOURCE_TYPES.includes(body.sourceType) ? body.sourceType : 'japanStore'
  const currency = CURRENCIES.includes(body.currency) ? body.currency : 'JPY'
  const condition = CONDITIONS.includes(body.condition) ? body.condition : 'new'
  const status = STATUSES.includes(body.status) ? body.status : 'considering'

  const base: Record<string, any> = {
    _type: 'priceEntry',
    productName,
    category: body.category,
    sourceType,
    price,
    currency,
    condition,
    status,
    taxIncluded: typeof body.taxIncluded === 'boolean' ? body.taxIncluded : true,
    seenAt: new Date().toISOString(),
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
