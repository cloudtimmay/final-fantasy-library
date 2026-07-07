import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const VALID_TYPES = ['shop', 'restaurant', 'sight', 'other']
const VALID_AREAS = ['Akihabara', 'Ikebukuro', 'Nakano', 'Shinjuku', 'Shibuya', 'Other']

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Bad request' })
  }

  const places = Array.isArray(body.places) ? body.places : []
  const placeType = VALID_TYPES.includes(body.placeType) ? body.placeType : 'shop'
  const area = VALID_AREAS.includes(body.area) ? body.area : undefined
  const priority = ['must', 'maybe', 'visited'].includes(body.priority) ? body.priority : 'maybe'

  if (places.length === 0) return json(400, { error: 'No places to import' })
  if (places.length > 200) return json(400, { error: 'Too many at once (max 200)' })

  let created = 0
  const errors: string[] = []

  for (const p of places) {
    const shopName = String(p.title || '').trim()
    if (!shopName) continue

    const doc: any = {
      _type: 'shopNote',
      shopName,
      placeType,
      priority,
    }
    if (area) doc.area = area
    if (p.note) doc.note = String(p.note).trim()
    // Store the Google Maps URL in the address field so the map/link can use it.
    if (p.url) doc.address = String(p.url).trim()

    try {
      await sanityWrite.create(doc)
      created++
    } catch (e) {
      errors.push(shopName)
    }
  }

  return json(200, { ok: true, created, failed: errors.length, failedNames: errors.slice(0, 10) })
}