import type { APIRoute } from 'astro'
import { sanity, sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody } from '../../lib/api'
import { planSaveDoc, withFlightDays, type PlanTrip } from '../../lib/trip-plans'

export const prerender = false

// The itinerary's plan, for one trip (lib/trip-plans.ts). The client only says which trip; the
// document is worked out here: the original `itineraryState` for the December 2026 trip (and for
// a save without a trip, as every save was before trips had their own plans), written exactly as
// before; `itineraryState-<tripId>` for any other trip.
export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const data = body.data
  if (typeof data !== 'string' || !data.length) return json(400, { error: 'Missing data' })
  if (data.length > 300000) return json(400, { error: 'Too large' })

  let trip: PlanTrip | null = null
  if (body.tripId != null) {
    if (typeof body.tripId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.tripId)) return json(400, { error: 'Bad trip' })
    try {
      trip = await sanity.fetch(`*[_type == "tripSettings" && _id == $id][0]{ _id, firstTokyoDay, lastTokyoDay, arrivalDate, flightHomeDate }`, { id: body.tripId })
      if (trip) trip = withFlightDays(trip) // the same days as the pages (lib/trip-plans.ts)
    } catch (e) {
      return json(500, { error: 'Save failed' })
    }
    if (!trip) return json(400, { error: 'Unknown trip' })
  }

  try {
    await sanityWrite.createOrReplace(planSaveDoc(trip, data) as any)
    return json(200, { ok: true })
  } catch (e) {
    return json(500, { error: 'Save failed' })
  }
}
