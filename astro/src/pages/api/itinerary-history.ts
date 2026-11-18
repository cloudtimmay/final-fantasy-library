import type { APIRoute } from 'astro'
import { sanity } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { savePlanWithSnapshot, tripForPlan } from '../../lib/plan-save'
import { planDocIdFor } from '../../lib/trip-plans'
import { SNAPSHOT_TYPE, restoreDayInPlan, changedDaysText } from '../../lib/plan-history'

export const prerender = false

// A trip's plan history (lib/plan-history.ts): GET ?tripId= — its snapshots, newest first, with
// what each save changed; POST { tripId, snapshotId, day? } — restore that snapshot (everything,
// or only `day`), saved as a new change (so it has a snapshot too, and can be undone).
export const GET: APIRoute = async ({ url }) => {
  let trip
  try { trip = await tripForPlan(url.searchParams.get('tripId')) } catch { return json(500, { error: 'Failed' }) }
  if (trip === 'bad' || trip === 'unknown') return json(400, { error: 'Bad trip' })
  try {
    const list: any[] = await sanity.fetch(`*[_type == $t && planDoc == $p] | order(_id desc) { "id": _id, savedAt, changedDays, note }`, { t: SNAPSHOT_TYPE, p: planDocIdFor(trip) })
    return json(200, { ok: true, snapshots: list.map((s) => ({ ...s, changedDays: s.changedDays || [], summary: changedDaysText(s.changedDays || []) })) })
  } catch { return json(500, { error: 'Failed' }) }
}

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })
  let trip
  try { trip = await tripForPlan(body.tripId) } catch { return json(500, { error: 'Failed' }) }
  if (trip === 'bad' || trip === 'unknown') return json(400, { error: 'Bad trip' })
  const planDoc = planDocIdFor(trip)
  const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : ''
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null
  if (!snapshotId) return json(400, { error: 'Missing snapshot' })
  try {
    const [snap, current] = await Promise.all([
      sanity.fetch(`*[_id == $id][0]{ _type, planDoc, data }`, { id: snapshotId }),
      sanity.fetch(`*[_id == $id][0]{ data }`, { id: planDoc }),
    ])
    // Only this trip's own snapshots.
    if (!snap || snap._type !== SNAPSHOT_TYPE || snap.planDoc !== planDoc || typeof snap.data !== 'string') return json(404, { error: 'No such snapshot for this trip' })
    let data: string | null = snap.data
    if (day) {
      if (typeof current?.data !== 'string') return json(409, { error: 'No current plan to restore a day into' })
      data = restoreDayInPlan(current.data, snap.data, day)
      if (!data) return json(422, { error: 'This snapshot can\'t be restored day by day' })
    }
    const { snapshotId: newSnapshot } = await savePlanWithSnapshot(trip, data!, new Date(), day ? `Restored ${day} from ${snapshotId}` : `Restored everything from ${snapshotId}`)
    return json(200, { ok: true, data, snapshotId: newSnapshot })
  } catch (e) {
    console.error('[itinerary-history] restore failed:', (e as any)?.message || e)
    return json(500, { error: 'Restore failed' })
  }
}
