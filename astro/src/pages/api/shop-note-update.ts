import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const PRIORITIES = ['must', 'maybe', 'visited']
const PLACE_TYPES = ['shop', 'restaurant', 'sight', 'other']

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Bad request' })
  }

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const shopName = String(body.shopName || '').trim()
  if (!shopName) return json(400, { error: 'Shop name is required' })

  const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))

  const areaRaw = String(body.area || '').trim()
  const area = areaRaw ? areaRaw.slice(0, 60) : undefined

  const tripIds: string[] = Array.isArray(body.tripIds)
    ? body.tripIds.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 30)
    : []

  const set: any = { shopName }
  const unset: string[] = []

  if (PLACE_TYPES.includes(body.placeType)) set.placeType = body.placeType

  if (tripIds.length > 0) {
    set.trips = tripIds.map((tid) => ({ _type: 'reference', _ref: tid, _key: tid }))
  } else {
    unset.push('trips')
  }

  if (area) set.area = area
  else unset.push('area')

  if (body.openingHours && String(body.openingHours).trim()) set.openingHours = String(body.openingHours).trim().slice(0, 200)
  else unset.push('openingHours')

  if (body.note && String(body.note).trim()) set.note = String(body.note).trim()
  else unset.push('note')

  if (PRIORITIES.includes(body.priority)) set.priority = body.priority

  if (body.address && String(body.address).trim()) set.address = String(body.address).trim()
  else unset.push('address')

  if (num(body.latitude) != null) set.latitude = num(body.latitude)
  else unset.push('latitude')

  if (num(body.longitude) != null) set.longitude = num(body.longitude)
  else unset.push('longitude')

  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing || existing._type !== 'shopNote') {
      return json(400, { error: 'Not a shop note' })
    }

    let tx = sanityWrite.patch(id).set(set)
    if (unset.length) tx = tx.unset(unset)
    const patched = await tx.commit()
    return json(200, { ok: true, id: patched._id })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}