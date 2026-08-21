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

  // Only allow patching familyPurchase documents, and only the status field.
  try {
    const patched = await sanityWrite
      .patch(id)
      .setIfMissing({})
      .set({ status })
      .commit()
    if (patched._type !== 'familyPurchase') {
      return json(400, { error: 'Not a family purchase' })
    }
    return json(200, { ok: true, id: patched._id, status })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}