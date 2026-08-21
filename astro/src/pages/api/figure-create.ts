import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc } from '../../lib/api'

export const prerender = false

const CATEGORIES = ['figure', 'plushie', 'wearable', 'other']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const doc = buildDoc(
    {
      _type: 'figure',
      title,
      status: 'owned',
      needsInfo: false,
      category: CATEGORIES.includes(body.category) ? body.category : 'figure',
    },
    body,
    [
      { from: 'series' },
      { from: 'manufacturer' },
      { from: 'year', type: 'num' },
      { from: 'scale' },
      { from: 'condition' },
      { from: 'barcode' },
      { from: 'externalImageUrl' },
      { from: 'purchasePriceYen', type: 'num' },
      { from: 'purchasePrice', type: 'num' },
      { from: 'acquiredDate' },
      { from: 'notes' },
    ]
  )

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}