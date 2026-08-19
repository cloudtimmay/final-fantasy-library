import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try { body = await request.json() } catch { return json(400, { error: 'Bad request' }) }

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
