import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try { body = await request.json() } catch { return json(400, { error: 'Bad request' }) }

  const id = String(body.id || '').trim()
  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!id) return json(400, { error: 'Missing id' })
  if (isNaN(lat) || isNaN(lng)) return json(400, { error: 'Invalid coordinates' })
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return json(400, { error: 'Out of range' })

  try {
    await sanityWrite.patch(id).set({ latitude: lat, longitude: lng }).commit()
    return json(200, { ok: true })
  } catch (e) {
    return json(500, { error: 'Save failed' })
  }
}