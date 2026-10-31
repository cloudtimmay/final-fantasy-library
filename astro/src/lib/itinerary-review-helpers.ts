// Pure, dependency-free helpers for the "Check day" itinerary review feature
// (api/itinerary-review.ts). Kept separate from that endpoint file (rather than exported
// from it directly) so they can be imported by tests without pulling in Astro's
// APIRoute/import.meta.env machinery.

export type ReviewStopInput = {
  name: string
  plannedTime: number // minutes since midnight
  durationMin: number
  lat: number | null
  lng: number | null
}

export type StopTransition = {
  distanceKm: number | null // null if either stop is missing coordinates
  gapMin: number // minutes between the end of the previous stop and the start of this one; can be negative if they overlap
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// For every stop after the first, computes the straight-line distance from the previous
// stop (haversine, null if either is missing coordinates) and the gap in minutes between
// the previous stop ending and this one starting — so the model is handed the arithmetic
// instead of being asked to do it itself. Index 0 always gets null (nothing precedes it).
export function computeTransitions(stops: ReviewStopInput[]): (StopTransition | null)[] {
  return stops.map((s, i) => {
    if (i === 0) return null
    const prev = stops[i - 1]
    const distanceKm =
      prev.lat != null && prev.lng != null && s.lat != null && s.lng != null
        ? haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: s.lat, lng: s.lng })
        : null
    const gapMin = s.plannedTime - (prev.plannedTime + prev.durationMin)
    return { distanceKm, gapMin }
  })
}

// Sums JPY amounts like "¥260" or "¥1,200" found in free text (shop notes) — used to
// estimate a day's total train fare from notes that mention real fares. Ignores anything
// that doesn't match; never throws.
export function extractJpyTotal(texts: Array<string | null | undefined>): number {
  let total = 0
  for (const text of texts) {
    if (!text) continue
    const matches = text.match(/¥\s?[\d,]+/g) || []
    for (const m of matches) {
      const n = Number(m.replace(/[¥,\s]/g, ''))
      if (isFinite(n)) total += n
    }
  }
  return total
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

// The flight home on the day it leaves: be at the airport 3 hours before departure (check-in
// plus the tax-free refund check at customs), and allow the trip there from central Tokyo.
// Used by /itinerary (the day's "✈️ Flight" line) and /api/itinerary-review (its input and a
// warning it adds itself), so both name the same latest time.
export const AIRPORTS: Record<string, { name: string; minutesFromTokyo: number }> = {
  Narita: { name: 'Narita International Airport', minutesFromTokyo: 90 },
  Haneda: { name: 'Haneda Airport', minutesFromTokyo: 60 },
}
export const AIRPORT_ARRIVAL_BEFORE_MIN = 180
export type FlightHome = { time: string; airport: string; terminal?: string }

// A flight with a valid "HH:MM" time and a known airport, or null.
export function parseFlightHome(raw: any): FlightHome | null {
  const time = typeof raw?.time === 'string' ? raw.time.trim() : ''
  const airport = typeof raw?.airport === 'string' ? raw.airport.trim() : ''
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !AIRPORTS[airport]) return null
  const terminal = typeof raw?.terminal === 'string' && raw.terminal.trim() ? raw.terminal.trim().slice(0, 20) : undefined
  return { time, airport, ...(terminal ? { terminal } : {}) }
}

// Minutes after midnight the day's last stop should end by: 23:00 from Narita -> 18:30.
export function latestEndForFlight(flight: FlightHome): number {
  const [h, m] = flight.time.split(':').map(Number)
  return h * 60 + m - AIRPORT_ARRIVAL_BEFORE_MIN - AIRPORTS[flight.airport].minutesFromTokyo
}

// A warning when the day's last stop (planned time + duration) ends after latestEndForFlight(),
// else null — added by /api/itinerary-review itself rather than left to the model.
export function flightDeadlineWarning(stops: ReviewStopInput[], flight: FlightHome) {
  const last = stops[stops.length - 1]
  if (!last) return null
  const end = last.plannedTime + last.durationMin
  const latest = latestEndForFlight(flight)
  if (end <= latest) return null
  return {
    severity: 'warning',
    stopIndex: stops.length - 1,
    message: `The day ends at ${formatClock(end)}, but for the ${flight.time} flight from ${flight.airport} you should leave central Tokyo by ${formatClock(latest)} (at the airport 3 hours before, about ${AIRPORTS[flight.airport].minutesFromTokyo} min to get there).`,
    suggestion: `End the last stop by ${formatClock(latest)}.`,
  }
}

// "✈️ Flight 23:00 from Narita (T1)"
export function flightLine(flight: FlightHome): string {
  return `✈️ Flight ${flight.time} from ${flight.airport}${flight.terminal ? ` (${flight.terminal})` : ''}`
}

// The review's input text for one day — pulled out of /api/itinerary-review (which can't be
// imported in a test, see find-prices-prompt.ts) so tests can check exactly what the model gets.
export function buildUserPrompt(dayLabel: string | null, dayArea: string | null, dayStartTime: string | null, stops: ReviewStopInput[], notesByStop: Array<string | null>, openingHoursByStop: Array<string | null>, flight: FlightHome | null = null): string {
  const transitions = computeTransitions(stops)
  const lines: string[] = []
  lines.push(`Day: ${dayLabel || '(no reliable date for this day)'}`)
  if (dayArea) lines.push(`Area: ${dayArea}`)
  if (dayStartTime) lines.push(`Day starts at: ${dayStartTime}`)
  if (flight) {
    const airport = AIRPORTS[flight.airport]
    lines.push(`Flight home today: departs ${flight.time} from ${airport.name}${flight.terminal ? ` (${flight.terminal})` : ''}.`)
    lines.push(`Be at the airport ${AIRPORT_ARRIVAL_BEFORE_MIN / 60} hours before departure (check-in plus the tax-free refund check at customs), and allow about 90 minutes from central Tokyo to Narita (about 60 minutes to Haneda). So the day's last stop must end by ${formatClock(latestEndForFlight(flight))} — warn if the plan ends later than that.`)
  }
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
