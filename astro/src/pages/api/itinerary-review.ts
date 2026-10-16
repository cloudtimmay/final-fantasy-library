import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { computeTransitions, extractJpyTotal, formatClock, type ReviewStopInput } from '../../lib/itinerary-review-helpers'

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
- A shop that is closed at its planned visit time, or (only if a weekday is given) closed on that weekday.
- Unrealistic travel time for the straight-line distance given between two consecutive stops, by train or on foot.
- Too many stops for the time actually available in the day.
- No break for food over a long day.
- Arriving at a stop long before shops in that area typically open.

Each stop may include a "note" written by the trip's owner, in their own words. That note can contain the REAL train route, travel time and fare they already looked up — when a note gives real travel information, trust it over the straight-line distance given for that gap, since the straight-line distance does not account for the actual train route.

After your review, respond with ONLY a JSON array (no other text, no markdown code fences, no explanation) of up to ${MAX_MODEL_ITEMS} objects, each with exactly these fields:
- severity: "warning" (something is likely actually wrong) or "tip" (worth considering, not necessarily wrong).
- stopIndex: the 0-based index of the specific stop this is about, or null if it concerns the whole day rather than one stop.
- message: a short, concrete description of the problem.
- suggestion: a short concrete suggestion, or null if there isn't one.

If the day looks fine, respond with an empty JSON array: []`

function buildUserPrompt(dayLabel: string | null, dayArea: string | null, dayStartTime: string | null, stops: ReviewStopInput[], notesByStop: Array<string | null>, openingHoursByStop: Array<string | null>): string {
  const transitions = computeTransitions(stops)
  const lines: string[] = []
  lines.push(`Day: ${dayLabel || '(no reliable date for this day)'}`)
  if (dayArea) lines.push(`Area: ${dayArea}`)
  if (dayStartTime) lines.push(`Day starts at: ${dayStartTime}`)
  lines.push('')
  lines.push('Stops, in order:')
  stops.forEach((s, i) => {
    const t = transitions[i]
    if (t) {
      const distText = t.distanceKm != null ? `${t.distanceKm.toFixed(2)} km straight-line from previous stop` : 'distance from previous stop unknown (missing coordinates)'
      lines.push(`  (gap before this stop: ${distText}, ${t.gapMin} min between previous stop ending and this one starting)`)
    }
    lines.push(`[${i}] ${s.name}`)
    lines.push(`    Planned time: ${formatClock(s.plannedTime)}, duration ${s.durationMin} min`)
    if (openingHoursByStop[i]) lines.push(`    Opening hours: ${openingHoursByStop[i]}`)
    if (notesByStop[i]) lines.push(`    Note from the trip owner (may contain real train route/fare — trust over the straight-line distance above): ${notesByStop[i]}`)
  })
  return lines.join('\n')
}

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const dayLabel = typeof body.dayLabel === 'string' && body.dayLabel.trim() ? body.dayLabel.trim() : null
  const dayArea = typeof body.dayArea === 'string' && body.dayArea.trim() ? body.dayArea.trim() : null
  const dayStartTime = typeof body.dayStartTime === 'string' && body.dayStartTime.trim() ? body.dayStartTime.trim() : null

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

  const totalFareJpy = extractJpyTotal(notesByStop)
  const maxModelItems = totalFareJpy > 0 ? MAX_MODEL_ITEMS - 1 : MAX_MODEL_ITEMS

  const userPrompt = buildUserPrompt(dayLabel, dayArea, dayStartTime, stops, notesByStop, openingHoursByStop)

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

  const items: { severity: string; stopIndex: number | null; message: string; suggestion: string | null }[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    if (!SEVERITIES.includes(item.severity)) continue
    const message = typeof item.message === 'string' && item.message.trim() ? item.message.trim().slice(0, 300) : ''
    if (!message) continue
    const stopIndex = typeof item.stopIndex === 'number' && Number.isInteger(item.stopIndex) && item.stopIndex >= 0 && item.stopIndex < stops.length ? item.stopIndex : null
    const suggestion = typeof item.suggestion === 'string' && item.suggestion.trim() ? item.suggestion.trim().slice(0, 300) : null
    items.push({ severity: item.severity, stopIndex, message, suggestion })
    if (items.length >= maxModelItems) break
  }

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
