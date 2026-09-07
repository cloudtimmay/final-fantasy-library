import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

// Live lookup of a single shop's coordinates — used by the itinerary's
// "fetch from shop" button, since the page's own shop list is only as
// fresh as its last load and the shop may have been fixed up since.
export const GET: APIRoute = async ({ url }) => {
  const id = (url.searchParams.get('id') || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  try {
    const doc = await sanity.fetch(
      `*[_type == "shopNote" && _id == $id][0]{ latitude, longitude }`,
      { id }
    )
    if (!doc) return json(200, { ok: true, found: false })

    const hasCoords = typeof doc.latitude === 'number' && typeof doc.longitude === 'number'
    if (!hasCoords) return json(200, { ok: true, found: true, hasCoords: false })

    return json(200, { ok: true, found: true, hasCoords: true, latitude: doc.latitude, longitude: doc.longitude })
  } catch {
    return json(500, { error: 'Lookup failed' })
  }
}

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

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