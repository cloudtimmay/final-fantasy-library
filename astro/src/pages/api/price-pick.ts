import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { isPick, PICK_NOTE_MAX } from '../../lib/picks'
import { isOwnerUser } from '../../lib/access-users'

export const prerender = false

// "💚 Picks" (/picks): buy or skip a price entry, and/or its short comment. Only the pick
// fields are ever written (pick, pickedBy, pickedAt, pickNote), only on a priceEntry. Who
// picked comes from the verified Cloudflare Access token (src/middleware.ts → locals.accessUser,
// lib/cf-access.ts), never from the body.
//   { id, pick: 'buy' | 'skip' | null }  — null (or '') takes the pick back off
//   { id, note: '…' }                     — '' clears it
//   { id, hidden: true | false }          — "🎁 Hide from Picks", the owner only (403 otherwise)
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await parseJsonBody(request)
  if (!body || typeof body !== 'object') return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })
  const hasPick = 'pick' in body
  const hasNote = 'note' in body
  const hasHidden = 'hidden' in body
  if (!hasPick && !hasNote && !hasHidden) return json(400, { error: 'Nothing to save' })
  if (hasHidden && typeof body.hidden !== 'boolean') return json(400, { error: 'Invalid hidden' })
  if (hasPick && body.pick !== null && body.pick !== '' && !isPick(body.pick)) return json(400, { error: 'Invalid pick' })
  if (hasNote && body.note != null && typeof body.note !== 'string') return json(400, { error: 'Invalid note' })

  // The logged-in user from the middleware; none (e.g. a Vercel preview): nothing is saved.
  const user = locals.accessUser
  if (!user) return json(401, { error: 'Not logged in through Cloudflare Access' })
  if (hasHidden && !isOwnerUser(user)) return json(403, { error: 'Only the owner can hide items from Picks' })

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
    if (hasHidden) {
      if (body.hidden) set.hiddenFromPicks = true
      else unset.push('hiddenFromPicks')
    }
    let patch = sanityWrite.patch(id)
    if (Object.keys(set).length) patch = patch.set(set)
    if (unset.length) patch = patch.unset(unset)
    const doc = await patch.commit()
    return json(200, { ok: true, pick: doc.pick ?? null, pickedBy: doc.pickedBy ?? '', pickedAt: doc.pickedAt ?? '', pickNote: doc.pickNote ?? '', hidden: doc.hiddenFromPicks === true })
  } catch {
    return json(500, { error: 'Save failed' })
  }
}
