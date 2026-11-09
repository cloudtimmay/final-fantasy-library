import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { extractJpyTotal, buildUserPrompt, modelReviewItems, reviewInputsFromBody, serverReviewItems, alreadyListedText, scheduleReviewItems, hoursReviewItems, dayWarningReviewItems, closedStopIndexes, type ReviewStopInput, type ReviewScheduleStop } from '../../lib/itinerary-review-helpers'
import { isIsoDate, formatDateLong } from '../../lib/trip-dates'
import { validateTrain, trainSummary, type TrainPlan } from '../../lib/train-plan'

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
- The timetable's own findings are computed exactly and already shown to the owner first (see "ALREADY LISTED" in the input): late arrivals, too little time to walk, arrive-early not met, closed shops, waiting for an opening, the flight deadline. Never repeat or contradict them. Do flag hours text that looks wrong or a shop type that is often closed at that time.
- Unrealistic travel time for the straight-line distance given between two consecutive stops, by train or on foot.
- Too many stops for the time actually available in the day.
- No break for food over a long day.
- Arriving at a stop long before shops in that area typically open.
- On a day with a flight home: a plan whose last stop ends later than the latest time given.
- Stops marked FIXED TIME are anchors (a reservation, a session): a tight connection into one is worth flagging. The timetable's travel times, leave-by times and PROBLEM lines are already computed — rely on them, don't recompute them.

Meals: a stop marked MEAL is the day's meal there (its place is a restaurant, or its tag or note says mat, lunsj, lunch, middag, dinner, frokost or breakfast). Don't suggest adding a meal near it, and never suggest adding a stop that is already in the plan (the same place or the same name).

Each stop may include a "note" written by the trip's owner, in their own words. That note can contain the REAL train route, travel time and fare they already looked up — when a note gives real travel information, trust it over the straight-line distance given for that gap, since the straight-line distance does not account for the actual train route.

After your review, respond with ONLY a JSON array (no other text, no markdown code fences, no explanation) of up to ${MAX_MODEL_ITEMS} objects, each with exactly these fields:
- severity: "warning" (something is likely actually wrong) or "tip" (worth considering, not necessarily wrong).
- stopIndex: the 0-based index of the specific stop this is about, or null if it concerns the whole day rather than one stop.
- message: a short, concrete description of the problem.
- suggestion: a short concrete suggestion, or null if there isn't one.
- action: an object, or null. Give one whenever the suggestion is a change to the item's stop (stopIndex must then be set): the owner gets an "Apply" button for it. Exactly one of these shapes, with exactly these key names and value types:
  {"type":"set_leave_time","leaveAt":"19:30"} — leaveAt is a 24-hour "HH:MM" string; leave the stop then.
  {"type":"change_duration","durationMin":45} — durationMin is a whole number of minutes; the new visit length.
  {"type":"move_position","toIndex":2} — toIndex is the 0-based new place in the day's order.
  {"type":"move_day","toDate":"2026-12-03"} — toDate is one of the dates under "Other days of the trip".
  {"type":"remove_stop"}
  null when the suggestion isn't one of these changes, or the item has no stop.

Example of the whole answer:
[{"severity":"warning","stopIndex":3,"message":"7 hours at BOOKOFF Akihabara Ekimae leaves no time for the cafe at 20:00.","suggestion":"Leave BOOKOFF by 19:30.","action":{"type":"set_leave_time","leaveAt":"19:30"}},
 {"severity":"tip","stopIndex":null,"message":"No break between 10:00 and 13:00.","suggestion":null,"action":null}]

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

  // The stops and the timetable (lib/itinerary-review-helpers.ts reviewInputsFromBody), and every
  // problem the server finds itself (serverReviewItems) — listed first, and given to the AI as found.
  const inputs = reviewInputsFromBody(body)
  if ('error' in inputs) return json(400, { error: inputs.error })
  // The flight only on the day it leaves (sent by /itinerary); anything malformed is ignored.
  const { stops, notesByStop, openingHoursByStop, daySchedule, schedule, airportTrain, flight } = inputs
  const serverItems = serverReviewItems(inputs)
  const totalFareJpy = extractJpyTotal(notesByStop)
  const maxModelItems = Math.max(1, MAX_MODEL_ITEMS - (totalFareJpy > 0 ? 1 : 0) - serverItems.length)

  // Back at the base — not on a day that ends at the airport.
  const backAtBase = daySchedule && daySchedule.returnLeg && !airportTrain ? { end: daySchedule.end, minutes: daySchedule.returnLeg.minutes } : null
  const trainLines = body.stops.map((raw: any) => { const t = trainOf(raw); return t ? trainSummary(t).replace(/^🚆 /, '') : null })
  // The trip's other days, for a "move_day" action (checked against this list too).
  const tripDays: string[] = Array.isArray(body.tripDays) ? body.tripDays.filter((d: unknown) => typeof d === 'string' && isIsoDate(d)).slice(0, 60) : []
  const otherDays = tripDays.filter((d) => d !== body.dayDate)
  const userPrompt = buildUserPrompt(dayLabel, dayArea, dayStartTime, stops, notesByStop, openingHoursByStop, flight, schedule, daySchedule?.segments || [], backAtBase, trainLines, airportTrain)
    + (otherDays.length ? `\n\nOther days of the trip (for move_day): ${otherDays.join(', ')}` : '')
    + alreadyListedText(serverItems)

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

  // The server's own findings first, then the AI's.
  items.unshift(...serverItems)

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
