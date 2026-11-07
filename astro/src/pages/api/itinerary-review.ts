import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { extractJpyTotal, buildUserPrompt, parseFlightHome, flightDeadlineWarning, modelReviewItems, scheduleReviewItems, hoursReviewItems, dayWarningReviewItems, closedStopIndexes, type ReviewStopInput, type ReviewScheduleStop } from '../../lib/itinerary-review-helpers'
import { scheduleDay, trainLeaveBy, type ScheduleStopInput } from '../../lib/itinerary-schedule'
import { extractNoteTravelMinutes } from '../../lib/route-optimizer'
import { isIsoDate, formatDateLong, weekdayIndex } from '../../lib/trip-dates'
import { validateTrain, trainTimes, trainSummary, type TrainPlan } from '../../lib/train-plan'

// A train from the request, only when it's valid.
const validTrain = (raw: unknown): TrainPlan | null => {
  const v = raw ? validateTrain(raw) : null
  return v && 'train' in v ? v.train : null
}
// A stop's train from the request.
const trainOf = (raw: any): TrainPlan | null => validTrain(raw?.train)

export const prerender = false

// Same model as identify-product.ts — this is a single, non-streaming judgment call over
// structured text (no images, no web search), comparable in complexity to that endpoint.
const MODEL = 'claude-haiku-5-5'

// No web search, so no multi-round-trip latency to budget for — identify-product.ts's
// 25s/2048 tokens is the closer reference point than find-prices.ts's 55s/8192. A day's
// worth of stops is more text than a single image read, so a bit more headroom than 2048.
const MAX_TOKENS = 3072
const TIMEOUT_MS = 25000

const SEVERITIES = ['warning', 'tip']
const MAX_MODEL_ITEMS = 8

const SYSTEM_PROMPT = `You are reviewing one day of a shopping itinerary in Tokyo, for problems worth flagging before the trip.

Report CONCRETE problems only — things actually wrong with this specific plan, not generic travel advice:
- Opening hours are already checked against the day's weekday and the timetable (closed that day, before opening, after closing, closing during the visit) and listed first — don't repeat those. Do flag hours text that looks wrong or a shop type that is often closed at that time.
- Unrealistic travel time for the straight-line distance given between two consecutive stops, by train or on foot.
- Too many stops for the time actually available in the day.
- No break for food over a long day.
- Arriving at a stop long before shops in that area typically open.
- On a day with a flight home: a plan whose last stop ends later than the latest time given.
- Stops marked FIXED TIME are anchors (a reservation, a session): a tight connection into one is worth flagging. The timetable's travel times, leave-by times and PROBLEM lines are already computed — rely on them, don't recompute them.

Each stop may include a "note" written by the trip's owner, in their own words. That note can contain the REAL train route, travel time and fare they already looked up — when a note gives real travel information, trust it over the straight-line distance given for that gap, since the straight-line distance does not account for the actual train route.

After your review, respond with ONLY a JSON array (no other text, no markdown code fences, no explanation) of up to ${MAX_MODEL_ITEMS} objects, each with exactly these fields:
- severity: "warning" (something is likely actually wrong) or "tip" (worth considering, not necessarily wrong).
- stopIndex: the 0-based index of the specific stop this is about, or null if it concerns the whole day rather than one stop.
- message: a short, concrete description of the problem.
- suggestion: a short concrete suggestion, or null if there isn't one.
- action: null, or ONE change to the plan that carries out the suggestion, for the item's stop, exactly one of:
  {"type":"set_leave_time","leaveAt":"HH:MM"} (leave the stop then),
  {"type":"change_duration","durationMin":45} (a new visit length in minutes),
  {"type":"move_position","toIndex":2} (0-based new place in the day's order),
  {"type":"move_day","toDate":"YYYY-MM-DD"} (only one of the other days listed under "Other days of the trip"),
  {"type":"remove_stop"}.
  Use null when the fix is not one of these, or the item has no stop. The owner decides whether to apply it.

If the day looks fine, respond with an empty JSON array: []`

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  // The day's calendar date ("YYYY-MM-DD") wins: its weekday is computed here (lib/trip-dates.ts),
  // never taken from a label. A plain label is only the fallback for an older client.
  const dayLabel = isIsoDate(body.dayDate)
    ? formatDateLong(body.dayDate)
    : typeof body.dayLabel === 'string' && body.dayLabel.trim() ? body.dayLabel.trim() : null
  const dayArea = typeof body.dayArea === 'string' && body.dayArea.trim() ? body.dayArea.trim() : null
  const dayStartTime = typeof body.dayStartTime === 'string' && body.dayStartTime.trim() ? body.dayStartTime.trim() : null
  // Only on the day the flight home leaves (sent by /itinerary); anything malformed is ignored.
  const flight = parseFlightHome(body.flight)

  if (!Array.isArray(body.stops) || body.stops.length === 0) return json(400, { error: 'Missing stops' })
  if (body.stops.length > 40) return json(400, { error: 'Too many stops' })

  const stops: ReviewStopInput[] = []
  const notesByStop: Array<string | null> = []
  const openingHoursByStop: Array<string | null> = []
  for (const raw of body.stops) {
    const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
    const plannedTime = typeof raw?.plannedTime === 'number' && isFinite(raw.plannedTime) ? raw.plannedTime : null
    const durationMin = typeof raw?.durationMin === 'number' && isFinite(raw.durationMin) ? raw.durationMin : null
    if (!name || plannedTime == null || durationMin == null) return json(400, { error: 'Invalid stop data' })
    const lat = typeof raw?.lat === 'number' && isFinite(raw.lat) ? raw.lat : null
    const lng = typeof raw?.lng === 'number' && isFinite(raw.lng) ? raw.lng : null
    stops.push({ name, plannedTime, durationMin, lat, lng })
    notesByStop.push(typeof raw?.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 500) : null)
    openingHoursByStop.push(typeof raw?.openingHours === 'string' && raw.openingHours.trim() ? raw.openingHours.trim().slice(0, 200) : null)
  }

  // The timetable, recomputed here from the raw stops with the same lib/itinerary-schedule.ts
  // /itinerary uses (fixed times, arrive-early, a travel time entered for a leg, the shop note,
  // otherwise the estimate) — nothing computed by the client is trusted.
  const hhmm = (v: unknown) => {
    const m = typeof v === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim()) : null
    return m ? +m[1] * 60 + +m[2] : null
  }
  const minutesField = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null)
  const point = (v: any) => (typeof v?.lat === 'number' && isFinite(v.lat) && typeof v?.lng === 'number' && isFinite(v.lng) ? { lat: v.lat, lng: v.lng } : null)
  const scheduleInputs: ScheduleStopInput[] = body.stops.map((raw: any, i: number) => {
    const fixedTime = hhmm(raw?.fixedTime)
    return {
      name: stops[i].name, lat: stops[i].lat, lng: stops[i].lng, durationMin: stops[i].durationMin,
      fixedTime,
      arriveEarlyMin: fixedTime != null ? minutesField(raw?.arriveEarlyMin, 240) : null,
      manualTravelMin: minutesField(raw?.manualTravelMin, 600),
      noteTravelMin: extractNoteTravelMinutes(notesByStop[i]),
      must: raw?.must === true,
      // "I'm here now" / "Leaving now" on the timeline: the same "HH:MM" check as fixed times.
      actualStart: hhmm(raw?.actualStart),
      actualEnd: hhmm(raw?.actualEnd),
      leaveAt: hhmm(raw?.leaveAt),
      // A chosen train on the leg in: validated like on the page (lib/train-plan.ts).
      train: trainTimes(trainOf(raw)),
    }
  })
  const base = point(body.base)
  const startMin = hhmm(dayStartTime) ?? stops[0].plannedTime
  // The leg after the last stop (lib/itinerary-plan.ts lastLegTrain): the train to the airport on the
  // flight day when one is planned (the day ends at the airport), else a train back to the base.
  const airportTrainTimes = flight ? trainTimes(body.flight?.airportTrain ? validTrain(body.flight.airportTrain) : null) : null
  const returnTrainTimes = !airportTrainTimes && body.returnTrain ? trainTimes(validTrain(body.returnTrain)) : null
  const dayDate = isIsoDate(body.dayDate) ? body.dayDate : null
  const daySchedule = base ? scheduleDay(scheduleInputs.map((x, i) => ({ ...x, openingHours: openingHoursByStop[i] })), startMin, base, { returnTrain: airportTrainTimes || returnTrainTimes, weekday: dayDate ? weekdayIndex(dayDate) : null, date: dayDate }) : null
  // When to leave the last stop for it, and when it reaches the airport (its arrival + the walk).
  const airportTrain = airportTrainTimes
    ? { leaveBy: trainLeaveBy(airportTrainTimes), atAirport: (daySchedule ? daySchedule.end : airportTrainTimes.arrival + airportTrainTimes.walkFromStationMin), summary: trainSummary(validTrain(body.flight.airportTrain)!).replace(/^🚆 /, '') }
    : null
  const schedule: ReviewScheduleStop[] | null = daySchedule
    ? daySchedule.stops.map((sched, i) => ({ fixedTime: scheduleInputs[i].fixedTime, arriveEarlyMin: scheduleInputs[i].arriveEarlyMin, sched }))
    : null
  const timetableItems = schedule ? scheduleReviewItems(stops.map((s) => s.name), schedule, daySchedule!.segments) : []
  // Opening hours against the day's weekday and the visits (the timetable's, else the client's times).
  const weekday = isIsoDate(body.dayDate) ? weekdayIndex(body.dayDate) : null
  const visits = stops.map((s, i) => (daySchedule ? { start: daySchedule.stops[i].start, end: daySchedule.stops[i].end } : { start: s.plannedTime, end: s.plannedTime + s.durationMin }))
  const hoursItems = hoursReviewItems(stops.map((s) => s.name), openingHoursByStop, weekday, visits, isIsoDate(body.dayDate) ? body.dayDate : null)
  // The day warning (a late train back to the base, closed stops) and late train legs.
  const closedIdx = closedStopIndexes(openingHoursByStop, weekday, visits, isIsoDate(body.dayDate) ? body.dayDate : null)
  const lateItems = daySchedule ? dayWarningReviewItems(stops.map((s) => s.name), daySchedule, closedIdx) : []

  const totalFareJpy = extractJpyTotal(notesByStop)
  // The flight deadline is checked here (flightDeadlineWarning), not left to the model.
  // … from when you're back at the base (the trip from the last stop included).
  const flightWarning = flight ? flightDeadlineWarning(stops, flight, daySchedule ? daySchedule.end : null, airportTrain) : null
  const maxModelItems = Math.max(1, MAX_MODEL_ITEMS - (totalFareJpy > 0 ? 1 : 0) - (flightWarning ? 1 : 0) - timetableItems.length - hoursItems.length - lateItems.length)

  // Back at the base — not on a day that ends at the airport.
  const backAtBase = daySchedule && daySchedule.returnLeg && !airportTrain ? { end: daySchedule.end, minutes: daySchedule.returnLeg.minutes } : null
  const trainLines = body.stops.map((raw: any) => { const t = trainOf(raw); return t ? trainSummary(t).replace(/^🚆 /, '') : null })
  // The trip's other days, for a "move_day" action (checked against this list too).
  const tripDays: string[] = Array.isArray(body.tripDays) ? body.tripDays.filter((d: unknown) => typeof d === 'string' && isIsoDate(d)).slice(0, 60) : []
  const otherDays = tripDays.filter((d) => d !== body.dayDate)
  const userPrompt = buildUserPrompt(dayLabel, dayArea, dayStartTime, stops, notesByStop, openingHoursByStop, flight, schedule, daySchedule?.segments || [], backAtBase, trainLines, airportTrain)
    + (otherDays.length ? `\n\nOther days of the trip (for move_day): ${otherDays.join(', ')}` : '')

  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[itinerary-review] ANTHROPIC_API_KEY set:', !!apiKey)
  if (!apiKey) return json(500, { error: 'API key missing' })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let raw: any
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      let errBody: any = null
      try {
        errBody = await res.json()
      } catch {}
      console.error('[itinerary-review] upstream error, status:', res.status, 'type:', errBody?.error?.type, 'message:', errBody?.error?.message)
      return json(502, { error: `API error: ${errBody?.error?.message || errBody?.error?.type || `HTTP ${res.status}`}` })
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return json(504, { error: 'Review timed out — try again' })
    console.error('[itinerary-review] request failed:', e?.message || e)
    return json(502, { error: 'API error: request failed' })
  }

  const textBlock = Array.isArray(raw?.content) ? raw.content.find((b: any) => b?.type === 'text') : null
  const text = textBlock?.text
  if (typeof text !== 'string') {
    console.error('[itinerary-review] no text block in response, stop_reason:', raw?.stop_reason, 'block types:', Array.isArray(raw?.content) ? raw.content.map((b: any) => b?.type) : raw?.content)
    return json(502, { error: 'Could not read the AI response' })
  }
  if (raw?.stop_reason === 'max_tokens') {
    console.error('[itinerary-review] response was truncated at max_tokens')
  }

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {}
    }
  }
  if (!Array.isArray(parsed)) {
    console.error('[itinerary-review] could not parse JSON array from model text:', text.slice(0, 500))
    return json(502, { error: 'Could not read the AI response' })
  }

  // The model's items, each action checked against the plan (dropped when it doesn't apply).
  const items: any[] = modelReviewItems(parsed, {
    stops: stops.map((s, i) => ({ name: s.name, plannedTime: daySchedule ? daySchedule.stops[i].start : s.plannedTime, durationMin: daySchedule ? daySchedule.stops[i].end - daySchedule.stops[i].start : s.durationMin })),
    dayDate: isIsoDate(body.dayDate) ? body.dayDate : null,
    tripDays,
  }, maxModelItems)

  if (flightWarning) items.unshift(flightWarning)
  items.unshift(...lateItems, ...timetableItems, ...hoursItems)

  // Computed deterministically from the notes' own fares, not left to the model's
  // arithmetic — matches the project's convention (see computeTransitions above) of
  // precomputing numbers rather than trusting the model with them.
  if (totalFareJpy > 0) {
    items.push({
      severity: 'tip',
      stopIndex: null,
      message: `Estimated total one-way train fare for the day: ¥${totalFareJpy.toLocaleString('en-US')} (estimate, based on fares mentioned in your shop notes).`,
      suggestion: null,
    })
  }

  return json(200, { ok: true, items })
}
