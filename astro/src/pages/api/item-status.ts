import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

const ALLOWED_TYPES = ['album', 'game', 'book', 'figure']
const ALLOWED_STATUS = ['owned', 'wishlist', 'sold', 'lent']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const status = String(body.status || '').trim()
  if (!ALLOWED_STATUS.includes(status)) return json(400, { error: 'Invalid status' })

  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing || !ALLOWED_TYPES.includes(existing._type)) {
      return json(400, { error: 'Not a collection item' })
    }
    const patched = await sanityWrite.patch(id).set({ status }).commit()
    return json(200, { ok: true, id: patched._id, status })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}