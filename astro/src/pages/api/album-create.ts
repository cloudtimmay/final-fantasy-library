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

  // Matches the album schema: composer, catalogNumber, releaseDate (string), format 'cd'.
  const doc: any = { _type: 'album', title, status: 'owned', format: 'cd' }
  if (str(body.composer)) doc.composer = str(body.composer)
  if (str(body.series)) doc.series = str(body.series)
  if (str(body.catalogNumber)) doc.catalogNumber = str(body.catalogNumber)
  if (str(body.releaseDate)) doc.releaseDate = str(body.releaseDate)
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