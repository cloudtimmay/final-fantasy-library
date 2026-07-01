import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Bad request' })
  }

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