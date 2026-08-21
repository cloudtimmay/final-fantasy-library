import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  // Matches the album schema: composer, catalogNumber, releaseDate (string), format 'cd'.
  const doc = buildDoc(
    { _type: 'album', title, status: 'owned', format: 'cd' },
    body,
    [
      { from: 'composer' },
      { from: 'series' },
      { from: 'catalogNumber' },
      { from: 'releaseDate' },
      { from: 'barcode' },
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