import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))
  const str = (v: any) => { const s = String(v ?? '').trim(); return s || undefined }

  const doc: any = { _type: 'game', title, status: 'owned' }
  if (str(body.platform)) doc.platform = str(body.platform)
  // Client sends the "Publisher / Developer" field as `creator` — game schema only has `publisher`.
  if (str(body.creator)) doc.publisher = str(body.creator)
  if (str(body.series)) doc.series = str(body.series)
  if (num(body.year) != null) doc.year = num(body.year)
  if (str(body.barcode)) doc.barcode = str(body.barcode)
  if (num(body.purchasePriceYen) != null) doc.purchasePriceYen = num(body.purchasePriceYen)
  if (num(body.purchasePrice) != null) doc.purchasePrice = num(body.purchasePrice)
  if (str(body.acquiredDate)) doc.acquiredDate = str(body.acquiredDate)
  if (str(body.notes)) doc.notes = str(body.notes)

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Save failed' })
  }
}