import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const CATEGORIES = ['figure', 'plushie', 'wearable', 'other']

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Bad request' })
  }

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))
  const str = (v: any) => (v == null ? undefined : String(v).trim() || undefined)

  const doc: any = {
    _type: 'figure',
    title,
    status: 'owned',
    needsInfo: false,
    category: CATEGORIES.includes(body.category) ? body.category : 'figure',
  }
  if (str(body.series)) doc.series = str(body.series)
  if (str(body.manufacturer)) doc.manufacturer = str(body.manufacturer)
  if (num(body.year) != null) doc.year = num(body.year)
  if (str(body.scale)) doc.scale = str(body.scale)
  if (str(body.condition)) doc.condition = str(body.condition)
  if (str(body.barcode)) doc.barcode = str(body.barcode)
  if (str(body.externalImageUrl)) doc.externalImageUrl = str(body.externalImageUrl)
  if (num(body.purchasePriceYen) != null) doc.purchasePriceYen = num(body.purchasePriceYen)
  if (num(body.purchasePrice) != null) doc.purchasePrice = num(body.purchasePrice)
  if (str(body.acquiredDate)) doc.acquiredDate = str(body.acquiredDate)
  if (str(body.notes)) doc.notes = str(body.notes)

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}