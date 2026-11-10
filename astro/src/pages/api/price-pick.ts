import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { accessUserFrom, LOCAL_DEV_USER } from '../../lib/access-users'
import { isPick, PICK_NOTE_MAX } from '../../lib/picks'

export const prerender = false

// "💚 Picks" (/picks): buy or skip a price entry, and/or its short comment. Only the pick
// fields are ever written (pick, pickedBy, pickedAt, pickNote), only on a priceEntry. Who
// picked comes from the Cloudflare Access login (lib/access-users.ts), never from the body.
//   { id, pick: 'buy' | 'skip' | null }  — null (or '') takes the pick back off
//   { id, note: '…' }                     — '' clears it
export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body || typeof body !== 'object') return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })
  const hasPick = 'pick' in body
  const hasNote = 'note' in body
  if (!hasPick && !hasNote) return json(400, { error: 'Nothing to save' })
  if (hasPick && body.pick !== null && body.pick !== '' && !isPick(body.pick)) return json(400, { error: 'Invalid pick' })
  if (hasNote && body.note != null && typeof body.note !== 'string') return json(400, { error: 'Invalid note' })

  // Behind Cloudflare Access there's always a login; without one only local development may save.
  const user = accessUserFrom(request) || (import.meta.env.DEV ? LOCAL_DEV_USER : null)
  if (!user) return json(401, { error: 'Not logged in through Cloudflare Access' })

  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing) return json(404, { error: 'Not found' })
    if (existing._type !== 'priceEntry') return json(400, { error: 'Not a price entry' })

    const set: Record<string, unknown> = {}
    const unset: string[] = []
    if (hasPick) {
      if (isPick(body.pick)) Object.assign(set, { pick: body.pick, pickedBy: user.name, pickedAt: new Date().toISOString() })
      else unset.push('pick', 'pickedBy', 'pickedAt')
    }
    if (hasNote) {
      const note = String(body.note ?? '').trim().slice(0, PICK_NOTE_MAX)
      if (note) set.pickNote = note
      else unset.push('pickNote')
    }
    let patch = sanityWrite.patch(id)
    if (Object.keys(set).length) patch = patch.set(set)
    if (unset.length) patch = patch.unset(unset)
    const doc = await patch.commit()
    return json(200, { ok: true, pick: doc.pick ?? null, pickedBy: doc.pickedBy ?? '', pickedAt: doc.pickedAt ?? '', pickNote: doc.pickNote ?? '' })
  } catch {
    return json(500, { error: 'Save failed' })
  }
}
