import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const ALLOWED_TYPES = ['album', 'game', 'book', 'merch', 'familyPurchase']

export const POST: APIRoute = async ({ request }) => {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json(400, { error: 'Bad request' })
  }

  const file = form.get('file')
  const docId = String(form.get('docId') || '').trim()
  const field = String(form.get('field') || 'image').trim()

  if (!(file instanceof File)) return json(400, { error: 'No file' })
  if (!docId) return json(400, { error: 'Missing docId' })
  if (field !== 'image' && field !== 'photos') return json(400, { error: 'Invalid field' })
  if (!file.type.startsWith('image/')) return json(400, { error: 'Not an image' })
  if (file.size > 10 * 1024 * 1024) return json(400, { error: 'Image too large (max 10MB)' })

  try {
    // Confirm the target document exists and is an allowed type.
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id: docId })
    if (!existing || !ALLOWED_TYPES.includes(existing._type)) {
      return json(400, { error: 'Invalid target document' })
    }

    // Upload the binary to Sanity's asset store.
    const buffer = Buffer.from(await file.arrayBuffer())
    const asset = await sanityWrite.assets.upload('image', buffer, {
      filename: file.name || 'upload.jpg',
      contentType: file.type,
    })

    const imageRef = {
      _type: 'image',
      asset: { _type: 'reference', _ref: asset._id },
    }

    if (field === 'photos') {
      // Append to an array field (e.g. familyPurchase receipts).
      await sanityWrite
        .patch(docId)
        .setIfMissing({ photos: [] })
        .append('photos', [{ ...imageRef, _key: asset._id }])
        .commit()
    } else {
      // Set the single main image field.
      await sanityWrite.patch(docId).set({ image: imageRef }).commit()
    }

    return json(200, { ok: true, assetId: asset._id, url: asset.url })
  } catch (e) {
    return json(500, { error: 'Upload failed' })
  }
}