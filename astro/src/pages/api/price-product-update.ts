import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { productKey } from '../../lib/price-products'

export const prerender = false

const CATEGORIES = ['album', 'game', 'book', 'figure', 'other']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const originalKey = String(body.key || '').trim()
  if (!originalKey) return json(400, { error: 'Missing product key' })

  const productName = String(body.productName || '').trim()
  if (!productName) return json(400, { error: 'Product name is required' })

  if (!CATEGORIES.includes(body.category)) return json(400, { error: 'Category is required' })

  const productNameJp = String(body.productNameJp || '').trim()
  const jan = String(body.jan || '').replace(/\D/g, '')

  // Recompute group membership server-side from the original key — a client-supplied
  // list of ids can't be trusted, and the group isn't stored anywhere as its own thing;
  // it only ever exists as "whichever priceEntry docs currently key to this value".
  const docs: { _id: string; productName?: string; jan?: string }[] = await sanity.fetch(
    `*[_type == "priceEntry" && !(_id in path("drafts.**"))]{ _id, productName, jan }`
  )
  const ids = docs.filter((d) => productKey(d.jan, d.productName) === originalKey).map((d) => d._id)
  if (ids.length === 0) return json(404, { error: 'Product not found' })

  const imageAssetIdRaw = String(body.imageAssetId || '').trim()
  const imageAssetId = imageAssetIdRaw.startsWith('image-') ? imageAssetIdRaw : null
  const removeImage = body.removeImage === true && !imageAssetId

  const tx = sanityWrite.transaction()
  for (const id of ids) {
    tx.patch(id, (p) => {
      let patch = p.set({ productName, category: body.category })
      patch = productNameJp ? patch.set({ productNameJp }) : patch.unset(['productNameJp'])
      patch = jan ? patch.set({ jan }) : patch.unset(['jan'])
      if (imageAssetId) {
        patch = patch.set({ image: { _type: 'image', asset: { _type: 'reference', _ref: imageAssetId } } })
      } else if (removeImage) {
        patch = patch.unset(['image'])
      }
      return patch
    })
  }

  try {
    await tx.commit()
    return json(200, { ok: true, updated: ids.length })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
