import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const doc = buildDoc(
    { _type: 'book', title, status: 'owned' },
    body,
    [
      // Client sends the "Author / Publisher" field as `creator` — book schema has separate
      // `author` (required) and `publisher` fields, so the same value goes to both.
      { from: 'creator', to: ['author', 'publisher'] },
      { from: 'year', type: 'num' },
      // Client sends the scanned code as `barcode` — book schema calls it `isbn`.
      { from: 'barcode', to: 'isbn' },
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
    return json(500, { error: 'Save failed' })
  }
}