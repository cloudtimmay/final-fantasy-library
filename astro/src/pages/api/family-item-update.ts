import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, imageFromAssetId } from '../../lib/api'
import { CATEGORIES } from '../../lib/price-entry-fields'

export const prerender = false

// Edits or deletes one familyItem (from /edit-family-item). Refuses any other document type,
// so a made-up id can't be used to change or delete a price, purchase or collection item.
// `person` is deliberately not editable here — who owns it is what the item is filed under.
export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id || id.startsWith('drafts.')) return json(400, { error: 'Missing item id' })

  const existing: { _type: string } | null = await sanity.fetch(`*[_id == $id][0]{ _type }`, { id })
  if (!existing) return json(404, { error: 'Item not found' })
  if (existing._type !== 'familyItem') return json(400, { error: 'Not a family item' })

  if (body.action === 'delete') {
    try {
      await sanityWrite.delete(id)
      return json(200, { ok: true, deleted: true })
    } catch {
      return json(500, { error: 'Delete failed' })
    }
  }

  const name = String(body.name || '').trim()
  if (!name) return json(400, { error: 'Name is required' })
  const category = String(body.category || '')
  if (category && !CATEGORIES.includes(category)) return json(400, { error: 'Invalid category' })

  const set: Record<string, unknown> = { name }
  const unset: string[] = []
  const optional = (key: string, value: string) => (value ? (set[key] = value) : unset.push(key))
  optional('nameJp', String(body.nameJp || '').trim())
  optional('jan', String(body.jan || '').replace(/\D/g, ''))
  optional('note', String(body.note || '').trim())
  optional('category', category)

  // A new photo already uploaded in the background (src/scripts/background-upload.js), or an
  // explicit removal; neither leaves the current photo alone.
  const image = imageFromAssetId(body.imageAssetId)
  if (image) set.image = image
  else if (body.removeImage === true) unset.push('image')

  try {
    let patch = sanityWrite.patch(id).set(set)
    if (unset.length) patch = patch.unset(unset)
    await patch.commit()
    return json(200, { ok: true })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
