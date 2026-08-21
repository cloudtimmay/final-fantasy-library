import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

const PRIORITIES = ['must', 'maybe', 'visited']
const PLACE_TYPES = ['shop', 'restaurant', 'sight', 'other']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const shopName = String(body.shopName || '').trim()
  if (!shopName) return json(400, { error: 'Shop name is required' })

  const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))

  const areaRaw = String(body.area || '').trim()
  const area = areaRaw ? areaRaw.slice(0, 60) : undefined

  const tripIds: string[] = Array.isArray(body.tripIds)
    ? body.tripIds.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 30)
    : []

  // _type hardcoded — client can never choose it.
  const doc: any = {
    _type: 'shopNote',
    shopName,
  }
  if (PLACE_TYPES.includes(body.placeType)) doc.placeType = body.placeType
  if (tripIds.length > 0) doc.trips = tripIds.map((tid) => ({ _type: 'reference', _ref: tid, _key: tid }))
  if (area) doc.area = area
  if (body.openingHours && String(body.openingHours).trim()) doc.openingHours = String(body.openingHours).trim().slice(0, 200)
  if (body.note) doc.note = String(body.note).trim()
  if (PRIORITIES.includes(body.priority)) doc.priority = body.priority
  if (body.address) doc.address = String(body.address).trim()
  if (num(body.latitude) != null) doc.latitude = num(body.latitude)
  if (num(body.longitude) != null) doc.longitude = num(body.longitude)

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}