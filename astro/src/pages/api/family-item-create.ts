import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc, imageFromAssetId } from '../../lib/api'
import { CATEGORIES, PEOPLE_LIST } from '../../lib/price-entry-fields'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const person = String(body.person || '').trim()
  // The owner too: a familyItem for OWNER is one of their "other things" (not Final Fantasy) —
  // their Final Fantasy items are collection documents, created elsewhere.
  if (!person || !PEOPLE_LIST.includes(person)) return json(400, { error: 'Please choose who owns it' })

  const name = String(body.name || '').trim()
  if (!name) return json(400, { error: 'Name is required' })

  const doc = buildDoc(
    { _type: 'familyItem', person, name },
    body,
    [
      { from: 'nameJp' },
      { from: 'jan' },
      { from: 'note' },
    ]
  )
  if (body.category && CATEGORIES.includes(body.category)) doc.category = body.category

  // A photo already uploaded in the background (src/scripts/background-upload.js).
  const image = imageFromAssetId(body.imageAssetId)
  if (image) doc.image = image

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}
