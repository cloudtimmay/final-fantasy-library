import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const AREAS = ['Akihabara', 'Ikebukuro', 'Nakano', 'Shinjuku', 'Shibuya', 'Other']
const PRIORITIES = ['must', 'maybe', 'visited']

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Bad request' })
  }

  const shopName = String(body.shopName || '').trim()
  if (!shopName) return json(400, { error: 'Shop name is required' })

  const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))

  // _type hardcoded — client can never choose it.
  const doc: any = {
    _type: 'shopNote',
    shopName,
  }
  if (AREAS.includes(body.area)) doc.area = body.area
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