import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildDoc } from '../../lib/api'
import { CATEGORIES, PEOPLE_LIST, OWNER } from '../../lib/price-entry-fields'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const person = String(body.person || '').trim()
  if (!person || !PEOPLE_LIST.includes(person)) return json(400, { error: 'Please choose who owns it' })
  if (person === OWNER) return json(400, { error: `${OWNER} gets a collection item instead of a family item` })

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

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}
