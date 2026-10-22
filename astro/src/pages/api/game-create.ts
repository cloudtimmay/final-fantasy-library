import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc, imageFromAssetId } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const doc = buildDoc(
    { _type: 'game', title, status: 'owned' },
    body,
    [
      { from: 'platform' },
      // Client sends the "Publisher / Developer" field as `creator` — game schema only has `publisher`.
      { from: 'creator', to: 'publisher' },
      { from: 'series' },
      { from: 'year', type: 'num' },
      { from: 'barcode' },
      { from: 'purchasePriceYen', type: 'num' },
      { from: 'purchasePrice', type: 'num' },
      { from: 'acquiredDate' },
      { from: 'notes' },
    ]
  )

  // A photo already uploaded in the background (src/scripts/background-upload.js).
  const image = imageFromAssetId(body.imageAssetId)
  if (image) doc.image = image

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Save failed' })
  }
}