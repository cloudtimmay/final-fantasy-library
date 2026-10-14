import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { SOURCE_TYPES, CURRENCIES, CONDITIONS, STATUSES } from '../../lib/price-entry-fields'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const existing = await sanity.fetch(`*[_id == $id][0]{ _id, _type }`, { id })
  if (!existing) return json(404, { error: 'Price entry not found' })
  if (existing._type !== 'priceEntry') return json(400, { error: 'Not a price entry' })

  if (body.action === 'delete') {
    try {
      await sanityWrite.delete(id)
      return json(200, { ok: true, deleted: true })
    } catch {
      return json(500, { error: 'Delete failed' })
    }
  }

  // Product-level fields (productName, productNameJp, jan, category, image) are
  // deliberately never touched here — they're only ever changed via /edit-product,
  // so the whole product group stays consistent.

  const price = Number(body.price)
  if (body.price === '' || body.price == null || isNaN(price) || price < 0) {
    return json(400, { error: 'Price is required and must be 0 or more' })
  }

  // Unlike creation (which defaults an invalid/missing value), an update must reject
  // one explicitly — the client is editing an existing, already-valid entry, so an
  // invalid value here means a bug or stale UI state, not a first-time omission.
  if (!SOURCE_TYPES.includes(body.sourceType)) return json(400, { error: 'Invalid source type' })
  if (!CURRENCIES.includes(body.currency)) return json(400, { error: 'Invalid currency' })
  if (!CONDITIONS.includes(body.condition)) return json(400, { error: 'Invalid condition' })
  if (!STATUSES.includes(body.status)) return json(400, { error: 'Invalid status' })

  const sourceType = body.sourceType
  const currency = body.currency
  const condition = body.condition
  const status = body.status

  const setFields: Record<string, any> = {
    price,
    currency,
    sourceType,
    condition,
    status,
    taxIncluded: typeof body.taxIncluded === 'boolean' ? body.taxIncluded : true,
  }
  const unsetFields: string[] = []

  // Shop vs. sourceName/url are mutually exclusive, gated by sourceType — same rule as
  // creation: never trust the client to only send the relevant one.
  if (sourceType === 'japanStore') {
    const shopId = String(body.shopId || '').trim()
    if (shopId) setFields.shop = { _type: 'reference', _ref: shopId, _weak: true }
    else unsetFields.push('shop')
    unsetFields.push('sourceName', 'url')
  } else {
    unsetFields.push('shop')
    const sourceName = String(body.sourceName || '').trim()
    if (sourceName) setFields.sourceName = sourceName
    else unsetFields.push('sourceName')
    const url = String(body.url || '').trim()
    if (url) setFields.url = url
    else unsetFields.push('url')
  }

  const extraCostNum = Number(body.extraCost)
  if (body.extraCost !== '' && body.extraCost != null && !isNaN(extraCostNum)) setFields.extraCost = extraCostNum
  else unsetFields.push('extraCost')

  const note = String(body.note || '').trim()
  if (note) setFields.note = note
  else unsetFields.push('note')

  try {
    const patch = sanityWrite.patch(id).set(setFields)
    if (unsetFields.length) patch.unset(unsetFields)
    await patch.commit()
    return json(200, { ok: true })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
