import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const taxFree = body.taxFree !== false

  const existing = await sanity.fetch(`*[_id == $id][0]{ _id, _type }`, { id })
  if (!existing) return json(404, { error: 'Family purchase not found' })
  if (existing._type !== 'familyPurchase') return json(400, { error: 'Not a family purchase' })

  try {
    await sanityWrite.patch(id).set({ taxFree }).commit()
    return json(200, { ok: true, id, taxFree })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
