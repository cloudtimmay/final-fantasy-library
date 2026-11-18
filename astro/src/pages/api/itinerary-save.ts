import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { savePlanWithSnapshot, tripForPlan } from '../../lib/plan-save'

export const prerender = false

// The itinerary's plan, for one trip (lib/trip-plans.ts). The client only says which trip; the
// document is worked out here: the original `itineraryState` for the December 2026 trip (and for
// a save without a trip, as every save was before trips had their own plans), written exactly as
// before; `itineraryState-<tripId>` for any other trip. The version it replaces is kept as an
// undo snapshot (lib/plan-save.ts, lib/plan-history.ts).
export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const data = body.data
  if (typeof data !== 'string' || !data.length) return json(400, { error: 'Missing data' })
  if (data.length > 300000) return json(400, { error: 'Too large' })

  let trip
  try { trip = await tripForPlan(body.tripId) } catch (e) { return json(500, { error: 'Save failed' }) }
  if (trip === 'bad') return json(400, { error: 'Bad trip' })
  if (trip === 'unknown') return json(400, { error: 'Unknown trip' })

  try {
    const { snapshotId } = await savePlanWithSnapshot(trip, data)
    return json(200, { ok: true, snapshotId })
  } catch (e) {
    return json(500, { error: 'Save failed' })
  }
}
