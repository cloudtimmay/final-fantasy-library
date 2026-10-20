import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildPatch } from '../../lib/api'
import { FIGURE_CATEGORIES } from '../../lib/collection-fields'

export const prerender = false

const CATEGORY_VALUES = FIGURE_CATEGORIES.map((c) => c.value)
const STATUSES = ['owned', 'wishlist', 'sold', 'lent']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const { set, unset } = buildPatch(body, [
    { from: 'series' },
    { from: 'manufacturer' },
    { from: 'year', type: 'num' },
    { from: 'scale' },
    { from: 'condition' },
    { from: 'barcode' },
    { from: 'category', type: 'enum', values: CATEGORY_VALUES },
    { from: 'status', type: 'enum', values: STATUSES },
    { from: 'acquiredDate' },
    { from: 'purchasePriceYen', type: 'num' },
    { from: 'purchasePrice', type: 'num' },
    { from: 'notes' },
  ])
  set.title = title
  set.needsInfo = body.needsInfo === true

  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing || existing._type !== 'figure') return json(400, { error: 'Not a merch item' })

    let tx = sanityWrite.patch(id).set(set)
    if (unset.length) tx = tx.unset(unset)
    const patched = await tx.commit()
    return json(200, { ok: true, id: patched._id })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
