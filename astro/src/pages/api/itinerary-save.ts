import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const data = body.data
  if (typeof data !== 'string' || !data.length) return json(400, { error: 'Missing data' })
  if (data.length > 300000) return json(400, { error: 'Too large' })

  try {
    await sanityWrite.createOrReplace({
      _id: 'itineraryState',
      _type: 'itineraryState',
      data,
      updatedAt: new Date().toISOString(),
    })
    return json(200, { ok: true })
  } catch (e) {
    return json(500, { error: 'Save failed' })
  }
}
