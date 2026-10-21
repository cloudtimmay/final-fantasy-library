import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const status = body.status === 'bought' ? 'bought' : 'planned'

  // Only allow patching familyPurchase documents, and only the status field — the type
  // is checked before anything is written.
  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing) return json(404, { error: 'Not found' })
    if (existing._type !== 'familyPurchase') {
      return json(400, { error: 'Not a family purchase' })
    }
    const patched = await sanityWrite.patch(id).set({ status }).commit()
    return json(200, { ok: true, id: patched._id, status })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}