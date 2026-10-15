import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { SOURCE_TYPES, CURRENCIES, CONDITIONS, STATUSES, OWNER } from '../../lib/price-entry-fields'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const existing = await sanity.fetch(
    `*[_id == $id][0]{
      _id, _type, productName, jan, category,
      "imageAssetId": image.asset._ref,
      sourceType, "shopId": shop._ref,
      "itemId": item._ref,
      "createdItemId": createdItem._ref,
      "createdFamilyPurchaseId": createdFamilyPurchase._ref,
      "createdFamilyPurchaseInfo": createdFamilyPurchase->{ name, person },
      "createdItemInfo": createdItem->{ title }
    }`,
    { id }
  )
  if (!existing) return json(404, { error: 'Price entry not found' })
  if (existing._type !== 'priceEntry') return json(400, { error: 'Not a price entry' })

  if (body.action === 'delete') {
    try {
      await sanityWrite.delete(id)
      return json(200, { ok: true, deleted: true })
    } catch {
      return json(500, { error: 'Delete failed' })
    }
  }

  // Product-level fields (productName, productNameJp, jan, category, image) are
  // deliberately never touched here — they're only ever changed via /edit-product,
  // so the whole product group stays consistent.

  const price = Number(body.price)
  if (body.price === '' || body.price == null || isNaN(price) || price < 0) {
    return json(400, { error: 'Price is required and must be 0 or more' })
  }

  // Unlike creation (which defaults an invalid/missing value), an update must reject
  // one explicitly — the client is editing an existing, already-valid entry, so an
  // invalid value here means a bug or stale UI state, not a first-time omission.
  if (!SOURCE_TYPES.includes(body.sourceType)) return json(400, { error: 'Invalid source type' })
  if (!CURRENCIES.includes(body.currency)) return json(400, { error: 'Invalid currency' })
  if (!CONDITIONS.includes(body.condition)) return json(400, { error: 'Invalid condition' })
  if (!STATUSES.includes(body.status)) return json(400, { error: 'Invalid status' })

  const sourceType = body.sourceType
  const currency = body.currency
  const condition = body.condition
  const status = body.status
  const taxIncluded = typeof body.taxIncluded === 'boolean' ? body.taxIncluded : true

  const buyer = String(body.buyer || '').trim() || undefined
  const tripId = String(body.tripId || '').trim() || undefined

  const extraCostNum = Number(body.extraCost)
  const hasExtraCost = body.extraCost !== '' && body.extraCost != null && !isNaN(extraCostNum)

  // --- Bought-specific validation & amount computation ---
  // Trip is optional — a purchase doesn't have to belong to a trip or budget. Without
  // one, no familyPurchase is created (nothing to attach a budget line to) and the budget
  // check below is skipped; the owner's collection item is still created/updated as
  // usual. The JPY/NOK requirement only matters when an amount will actually be recorded
  // somewhere (a familyPurchase, or a collection item for the owner) — a non-owner buyer
  // with no trip never creates anything, so an arbitrary currency is fine for them.
  let amount = 0
  if (status === 'bought') {
    if (!buyer) return json(400, { error: 'Buyer is required to mark as Bought' })

    const willCreateSomething = !!tripId || buyer === OWNER
    if (willCreateSomething && currency !== 'JPY' && currency !== 'NOK') {
      return json(400, { error: 'Mark as Bought requires the price to be in JPY or NOK. Please enter the price in NOK.' })
    }

    if (tripId) {
      const trip = await sanity.fetch(`*[_id == $id][0]{ _id, childBudgets[]{ person } }`, { id: tripId })
      if (!trip) return json(400, { error: 'Unknown trip' })
      const validPeople: string[] = (trip.childBudgets || []).map((c: any) => c.person).filter(Boolean)
      if (!validPeople.includes(buyer)) {
        return json(400, { error: `${buyer} has no budget line on this trip` })
      }
    }

    if (willCreateSomething) {
      const taxAdjusted = currency === 'JPY' && !taxIncluded ? Math.round(price * 1.1) : price
      amount = taxAdjusted + (hasExtraCost ? extraCostNum : 0)
    }
  }

  // --- priceEntry field patch (applies regardless of status) ---
  const setFields: Record<string, any> = { price, currency, sourceType, condition, status, taxIncluded }
  const unsetFields: string[] = []

  if (buyer) setFields.buyer = buyer
  else unsetFields.push('buyer')
  if (tripId) setFields.trip = { _type: 'reference', _ref: tripId, _weak: true }
  else unsetFields.push('trip')

  if (sourceType === 'japanStore') {
    const shopId = String(body.shopId || '').trim()
    if (shopId) setFields.shop = { _type: 'reference', _ref: shopId, _weak: true }
    else unsetFields.push('shop')
    unsetFields.push('sourceName', 'url')
  } else {
    unsetFields.push('shop')
    const sourceName = String(body.sourceName || '').trim()
    if (sourceName) setFields.sourceName = sourceName
    else unsetFields.push('sourceName')
    const url = String(body.url || '').trim()
    if (url) setFields.url = url
    else unsetFields.push('url')
  }

  if (hasExtraCost) setFields.extraCost = extraCostNum
  else unsetFields.push('extraCost')

  const note = String(body.note || '').trim()
  if (note) setFields.note = note
  else unsetFields.push('note')

  // --- Bought side effects: familyPurchase (only with a trip) + collection item (owner only) ---
  // Both are created at most once per priceEntry — if createdFamilyPurchase/createdItem
  // is already set, re-saving while still Bought is a no-op for this part, so reverting
  // and re-marking Bought (nothing was ever deleted) never produces a duplicate. If this
  // was first bought without a trip and later gets one, createdFamilyPurchaseId is still
  // unset, so saving as Bought again creates it then — exactly once, same as any other
  // first-time Bought save.
  const tx = sanityWrite.transaction()

  if (status === 'bought') {
    const today = new Date().toISOString().split('T')[0]

    if (tripId && !existing.createdFamilyPurchaseId) {
      const fpId = randomUUID()
      const fpDoc: Record<string, any> = {
        _id: fpId,
        _type: 'familyPurchase',
        name: existing.productName,
        person: buyer,
        trip: { _type: 'reference', _ref: tripId },
        status: 'bought',
        purchaseDate: today,
      }
      if (existing.jan) fpDoc.barcode = existing.jan
      if (sourceType === 'japanStore' && existing.shopId) {
        fpDoc.store = { _type: 'reference', _ref: existing.shopId }
      }
      if (existing.imageAssetId) {
        fpDoc.photos = [{ _type: 'image', asset: { _type: 'reference', _ref: existing.imageAssetId }, _key: existing.imageAssetId }]
      }
      if (currency === 'JPY') fpDoc.priceYen = amount
      else fpDoc.priceNok = amount

      tx.create(fpDoc)
      setFields.createdFamilyPurchase = { _type: 'reference', _ref: fpId, _weak: true }
    }

    if (buyer === OWNER) {
      if (existing.itemId) {
        // Already linked to a library item — flip it to owned, filling only blanks.
        const item = await sanity.fetch(
          `*[_id == $id][0]{ _id, _type, image, acquiredDate, purchasePrice, purchasePriceYen, barcode, isbn }`,
          { id: existing.itemId }
        )
        if (item) {
          const itemSet: Record<string, any> = { status: 'owned' }
          if (!item.image && existing.imageAssetId) {
            itemSet.image = { _type: 'image', asset: { _type: 'reference', _ref: existing.imageAssetId } }
          }
          if (!item.acquiredDate) itemSet.acquiredDate = today
          if (currency === 'JPY') {
            if (item.purchasePriceYen == null) itemSet.purchasePriceYen = amount
          } else if (item.purchasePrice == null) {
            itemSet.purchasePrice = amount
          }
          if (existing.jan) {
            if (item._type === 'book') { if (!item.isbn) itemSet.isbn = existing.jan }
            else if (!item.barcode) itemSet.barcode = existing.jan
          }
          tx.patch(existing.itemId, (p) => p.set(itemSet))
          if (!existing.createdItemId) {
            setFields.createdItem = { _type: 'reference', _ref: existing.itemId, _weak: true }
          }
        }
      } else if (existing.category && existing.category !== 'other' && !existing.createdItemId) {
        const itemId = randomUUID()
        const itemDoc: Record<string, any> = {
          _id: itemId,
          _type: existing.category,
          title: existing.productName,
          status: 'owned',
          needsInfo: true,
          acquiredDate: today,
        }
        if (existing.category === 'figure') itemDoc.category = 'figure'
        if (existing.jan) {
          if (existing.category === 'book') itemDoc.isbn = existing.jan
          else itemDoc.barcode = existing.jan
        }
        if (existing.imageAssetId) {
          itemDoc.image = { _type: 'image', asset: { _type: 'reference', _ref: existing.imageAssetId } }
        }
        if (currency === 'JPY') itemDoc.purchasePriceYen = amount
        else itemDoc.purchasePrice = amount

        tx.create(itemDoc)
        setFields.createdItem = { _type: 'reference', _ref: itemId, _weak: true }
      }
      // category === 'other' and no linked item: no collection item (a familyPurchase is
      // still created above if there's a trip).
    }
    // buyer !== OWNER: collection is never touched, regardless of item/category — and
    // without a trip, nothing at all is created here, only the status/fields patch below.
  }

  tx.patch(id, (p) => {
    let patch = p.set(setFields)
    if (unsetFields.length) patch = patch.unset(unsetFields)
    return patch
  })

  try {
    await tx.commit()
    return json(200, {
      ok: true,
      createdFamilyPurchaseInfo: existing.createdFamilyPurchaseInfo || null,
      createdItemInfo: existing.createdItemInfo || null,
    })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
