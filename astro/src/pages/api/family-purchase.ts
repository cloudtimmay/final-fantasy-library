import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const POST: APIRoute = async ({ request }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Bad request' })
  }

  // --- Whitelist + validate (never trust the client beyond these) ---
  const name = String(body.name || '').trim()
  if (!name) return json(400, { error: 'Name is required' })

  const person = String(body.person || '').trim()
  if (!person) return json(400, { error: 'Person is required' })

  const tripId = String(body.tripId || '').trim()
  if (!tripId) return json(400, { error: 'Trip is required' })

  const status = body.status === 'bought' ? 'bought' : 'planned'
  const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v))

  // Validate that person/trip actually exist and are consistent, using the read client.
  const trip = await sanity.fetch(
    `*[_type == "tripSettings" && _id == $id][0]{ _id, childBudgets[]{ person } }`,
    { id: tripId }
  )
  if (!trip) return json(400, { error: 'Unknown trip' })

  const validPeople: string[] = (trip.childBudgets || []).map((c: any) => c.person).filter(Boolean)
  if (validPeople.length && !validPeople.includes(person)) {
    return json(400, { error: 'Person has no budget on this trip' })
  }

  // --- Build the document. _type is hardcoded — client can never choose it. ---
  const doc: any = {
    _type: 'familyPurchase',
    name,
    person,
    status,
    trip: { _type: 'reference', _ref: tripId },
    purchaseDate: body.purchaseDate || new Date().toISOString().split('T')[0],
  }
  if (body.storeId) doc.store = { _type: 'reference', _ref: String(body.storeId) }
  if (num(body.priceYen) != null) doc.priceYen = num(body.priceYen)
  if (num(body.priceNok) != null) doc.priceNok = num(body.priceNok)
  if (body.barcode) doc.barcode = String(body.barcode).trim()

  try {
    const created = await sanityWrite.create(doc)
    return json(200, { ok: true, id: created._id })
  } catch {
    return json(500, { error: 'Create failed' })
  }
}