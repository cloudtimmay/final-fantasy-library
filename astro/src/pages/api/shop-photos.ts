import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

// A shop's photos (shopNote.photos), one at a time by its _key — the photo itself is added by
// /api/upload-image (field "photos"), which appends it. Removing a photo only takes it out of
// the shop: the image asset stays in the media library (like every replaced photo, see
// CLEANUP.md).
//   { id, key, action: 'caption', caption }  — '' removes the caption
//   { id, key, action: 'remove' }
//   { id, key, action: 'move', dir: -1 | 1 }  — one step up/down
// Answers with the photos' keys in their (new) order.
const ACTIONS = ['caption', 'remove', 'move']
const MAX_CAPTION = 100

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  const key = String(body.key || '').trim()
  const action = String(body.action || '')
  if (!id || !key) return json(400, { error: 'Missing id or key' })
  if (!ACTIONS.includes(action)) return json(400, { error: 'Invalid action' })
  const dir = Number(body.dir)
  if (action === 'move' && dir !== -1 && dir !== 1) return json(400, { error: 'Invalid direction' })

  try {
    const shop = await sanityWrite.fetch(`*[_id == $id][0]{ _type, _rev, "photos": photos[]{ _key } }`, { id })
    if (!shop || shop._type !== 'shopNote') return json(400, { error: 'Not a shop note' })
    const keys: string[] = (shop.photos || []).map((p: { _key: string }) => p._key)
    const at = keys.indexOf(key)
    if (at < 0) return json(404, { error: 'No such photo' })
    // The key came from the shop itself (checked above), so it's safe in the path.
    const path = `photos[_key=="${key}"]`

    if (action === 'caption') {
      const caption = String(body.caption ?? '').trim().slice(0, MAX_CAPTION)
      const patch = caption ? sanityWrite.patch(id).set({ [`${path}.caption`]: caption }) : sanityWrite.patch(id).unset([`${path}.caption`])
      await patch.commit()
      return json(200, { ok: true, keys })
    }

    if (action === 'remove') {
      await sanityWrite.patch(id).unset([path]).commit()
      return json(200, { ok: true, keys: keys.filter((k) => k !== key) })
    }

    // move: swap with its neighbour — against the revision just read, so a change made in
    // between (another phone) isn't overwritten; the client reloads the order on a conflict.
    const to = at + dir
    if (to < 0 || to >= keys.length) return json(200, { ok: true, keys })
    const full = await sanityWrite.fetch(`*[_id == $id][0]{ _rev, photos }`, { id })
    if (!full || full._rev !== shop._rev) return json(409, { error: 'The photos changed — reload the page' })
    const photos = [...full.photos]
    ;[photos[at], photos[to]] = [photos[to], photos[at]]
    await sanityWrite.patch(id).ifRevisionId(full._rev).set({ photos }).commit()
    return json(200, { ok: true, keys: photos.map((p: { _key: string }) => p._key) })
  } catch (e: any) {
    if (e?.statusCode === 409) return json(409, { error: 'The photos changed — reload the page' })
    return json(500, { error: 'Update failed' })
  }
}
