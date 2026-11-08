// Pure helpers (no I/O) for the "Check day" itinerary review feature
// (api/itinerary-review.ts). Kept separate from that endpoint file (rather than exported
// from it directly) so they can be imported by tests without pulling in Astro's
// APIRoute/import.meta.env machinery.
import { checkHours, closedOnArrival, visitWarning } from './opening-hours'
import { trainEarlyHint } from './itinerary-schedule'
import { LEAVE_BUFFER_MIN, dayWarning, dayWarningMessages, lastTrainLegs, LAST_TRAIN_MESSAGE, scheduleDay, trainLeaveBy, type DaySchedule, type ScheduledStop, type SegmentOverrun, type ScheduleStopInput, type TrainTimes } from './itinerary-schedule'
import { validateTrain, trainTimes, trainSummary, type TrainPlan } from './train-plan'
import { extractNoteTravelMinutes } from './route-optimizer'
import { isIsoDate, weekdayIndex } from './trip-dates'

export type ReviewStopInput = {
  meal?: boolean // a meal (isMealStop): marked in the prompt
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

const flightMinutes = (flight: FlightHome) => { const [h, m] = flight.time.split(':').map(Number); return h * 60 + m }
// Minutes after midnight the day's last stop should end by: 23:00 from Narita -> 18:30.
export function latestEndForFlight(flight: FlightHome): number {
  return flightMinutes(flight) - AIRPORT_ARRIVAL_BEFORE_MIN - AIRPORTS[flight.airport].minutesFromTokyo
}

// A warning when the day's last stop (planned time + duration) ends after latestEndForFlight(),
// else null — added by /api/itinerary-review itself rather than left to the model.
// `backAtBase`: when the day really ends — back at the base after the trip from the last stop
// (itinerary-schedule.ts DaySchedule.end); without it, the last stop's end.
// `airportTrain`: a train planned to the airport (from the last stop) — then the check is whether it
// gets there (its arrival + the walk, `atAirport`) before check-in closes, not the fixed estimate.
export function flightDeadlineWarning(stops: ReviewStopInput[], flight: FlightHome, backAtBase: number | null = null, airportTrain: { leaveBy: number; atAirport: number } | null = null) {
  const last = stops[stops.length - 1]
  if (!last) return null
  if (airportTrain) {
    const checkInBy = flightMinutes(flight) - AIRPORT_ARRIVAL_BEFORE_MIN
    if (airportTrain.atAirport <= checkInBy) return null
    return {
      severity: 'warning',
      stopIndex: stops.length - 1,
      message: `The train to the airport gets there at ${formatClock(airportTrain.atAirport)}, but for the ${flight.time} flight from ${flight.airport} you should be there by ${formatClock(checkInBy)} (3 hours before).`,
      suggestion: `Take a train that reaches ${flight.airport} by ${formatClock(checkInBy)}.`,
    }
  }
  const end = backAtBase ?? last.plannedTime + last.durationMin
  const latest = latestEndForFlight(flight)
  if (end <= latest) return null
  return {
    severity: 'warning',
    stopIndex: stops.length - 1,
    message: `The day ends ${backAtBase != null ? 'back at the base ' : ''}at ${formatClock(end)}, but for the ${flight.time} flight from ${flight.airport} you should leave central Tokyo by ${formatClock(latest)} (at the airport 3 hours before, about ${AIRPORTS[flight.airport].minutesFromTokyo} min to get there).`,
    suggestion: `End the last stop by ${formatClock(latest)}.`,
  }
}

// "✈️ Flight 23:00 from Narita (T1)"
export function flightLine(flight: FlightHome): string {
  return `✈️ Flight ${flight.time} from ${flight.airport}${flight.terminal ? ` (${flight.terminal})` : ''}`
}

// The day's timetable as the review sees it: one entry per stop, from lib/itinerary-schedule.ts
// (the same scheduleDay /itinerary shows). Computed by /api/itinerary-review itself from the
// raw stops, so the model gets travel, anchors and leave-by times it doesn't have to work out.
export type ReviewScheduleStop = {
  fixedTime: number | null
  arriveEarlyMin: number | null
  sched: ScheduledStop
}

const LEG_SOURCE: Record<string, string> = { manual: 'entered by the trip owner', note: "from the shop's note", estimate: 'estimate' }

// Deterministic findings from the timetable — added by the endpoint itself, not left to the
// model: once per segment of stops that runs past a fixed-time stop (not once per stop — it's
// one overrun), a fixed stop that ends after its leave-by time, and a tight connection (under
// TIGHT_CONNECTION_MIN spare, on top of the LEAVE_BUFFER_MIN already counted) to a fixed-time stop.
export const TIGHT_CONNECTION_MIN = 10
export function scheduleReviewItems(names: string[], schedule: ReviewScheduleStop[], segments: SegmentOverrun[] = []) {
  const leaveItems: { severity: 'warning' | 'tip'; stopIndex: number | null; message: string; suggestion: string | null }[] = schedule.flatMap((sc, i) => sc.sched.arrivesAfterLeave != null
    ? [{ severity: 'warning' as const, stopIndex: i, message: `${names[i]}: arrives after your leave time (${formatClock(sc.sched.arrivesAfterLeave)}).`, suggestion: 'Leave the stop before it earlier, or change the leave time.' }]
    : [])
  // A chosen train arriving much earlier than a fixed time: a tip.
  leaveItems.push(...schedule.flatMap((sc, i) => sc.sched.trainEarly
    ? [{ severity: 'tip' as const, stopIndex: i, message: `${names[i]}: ${trainEarlyHint(sc.sched.trainEarly)}`, suggestion: null }]
    : []))
  // A chosen train arriving too late for a fixed-time stop.
  leaveItems.push(...schedule.flatMap((sc, i) => sc.sched.trainLateMin != null
    ? [{ severity: 'warning' as const, stopIndex: i, message: `${names[i]}: the chosen train arrives ${sc.sched.trainLateMin} min too late for its fixed time.`, suggestion: 'Take an earlier train.' }]
    : []))
  const items: { severity: 'warning' | 'tip'; stopIndex: number | null; message: string; suggestion: string | null }[] = []
  segments.forEach((g) => {
    items.push({
      severity: 'warning', stopIndex: g.firstLateIndex,
      message: `The stops before ${names[g.anchorIndex]} at ${formatClock(g.anchorTime)} need ${g.overrunMin} min more than available — from ${names[g.firstLateIndex]} on, you won't make it in time.`,
      suggestion: g.suggestions.length
        ? `Shorten a visit or remove a stop. Longest visits: ${g.suggestions.map((x) => `${x.name} (${x.durationMin} min)`).join(', ')}.`
        : 'Shorten a visit or remove a stop.',
    })
  })
  schedule.forEach(({ sched: x }, i) => {
    const next = names[i + 1]
    if (x.doesntFit) {
      return // covered by its segment's item above
    } else if (x.leaveEarlierMin && next) {
      items.push({
        severity: 'warning', stopIndex: i,
        message: `Leave ${names[i]} ${x.leaveEarlierMin} min earlier to reach ${next} in time (leave by ${formatClock(x.leaveBy!)}).`,
        suggestion: null,
      })
    } else if (x.nextIsAnchor && x.leaveBy != null && x.leaveBy - x.end < TIGHT_CONNECTION_MIN && next) {
      items.push({
        severity: 'tip', stopIndex: i,
        message: `Tight connection: only ${x.leaveBy - x.end} min spare after ${names[i]} before you must leave for ${next} (leave by ${formatClock(x.leaveBy)}).`,
        suggestion: null,
      })
    }
  })
  return [...leaveItems, ...items]
}

// The review's input text for one day — pulled out of /api/itinerary-review (which can't be
// imported in a test, see find-prices-prompt.ts) so tests can check exactly what the model gets.
export function buildUserPrompt(dayLabel: string | null, dayArea: string | null, dayStartTime: string | null, stops: ReviewStopInput[], notesByStop: Array<string | null>, openingHoursByStop: Array<string | null>, flight: FlightHome | null = null, schedule: ReviewScheduleStop[] | null = null, segments: SegmentOverrun[] = [], backAtBase: { end: number; minutes: number } | null = null, trainLines: Array<string | null> = [], airportTrain: { summary: string; leaveBy: number; atAirport: number } | null = null): string {
  const transitions = computeTransitions(stops)
  const lines: string[] = []
  lines.push(`Day: ${dayLabel || '(no reliable date for this day)'}`)
  if (dayArea) lines.push(`Area: ${dayArea}`)
  if (dayStartTime) lines.push(`Day starts at: ${dayStartTime}`)
  if (flight) {
    const airport = AIRPORTS[flight.airport]
    lines.push(`Flight home today: departs ${flight.time} from ${airport.name}${flight.terminal ? ` (${flight.terminal})` : ''}.`)
    if (airportTrain) {
      // The train chosen to the airport sets the deadline (the timetable below already uses it).
      lines.push(`Train to the airport, chosen by the owner, from the day's last stop: ${airportTrain.summary}. Leave the last stop by ${formatClock(airportTrain.leaveBy)}; it reaches the airport at ${formatClock(airportTrain.atAirport)}.`)
      lines.push(`Be at the airport ${AIRPORT_ARRIVAL_BEFORE_MIN / 60} hours before departure (check-in plus the tax-free refund check at customs), so by ${formatClock(flightMinutes(flight) - AIRPORT_ARRIVAL_BEFORE_MIN)} — the deadline is that train, not a general estimate of the trip to the airport.`)
    } else {
      lines.push(`Be at the airport ${AIRPORT_ARRIVAL_BEFORE_MIN / 60} hours before departure (check-in plus the tax-free refund check at customs), and allow about 90 minutes from central Tokyo to Narita (about 60 minutes to Haneda). So the day's last stop must end by ${formatClock(latestEndForFlight(flight))} — warn if the plan ends later than that.`)
    }
  }
  lines.push('')
  lines.push('Stops, in order:')
  stops.forEach((s, i) => {
    const t = transitions[i]
    if (t) {
      const distText = t.distanceKm != null ? `${t.distanceKm.toFixed(2)} km straight-line from previous stop` : 'distance from previous stop unknown (missing coordinates)'
      lines.push(`  (gap before this stop: ${distText}, ${t.gapMin} min between previous stop ending and this one starting)`)
    }
    const seg = segments.find((g) => g.anchorIndex === i)
    if (seg) lines.push(`  (PROBLEM for the stops before this fixed-time stop: together they need ${seg.overrunMin} min more than available; the first that can't make it is [${seg.firstLateIndex}])`)
    lines.push(`[${i}] ${s.name}`)
    lines.push(`    Planned time: ${formatClock(s.plannedTime)}, duration ${s.durationMin} min`)
    if (s.meal) lines.push('    MEAL (already the day\'s meal here — don\'t suggest adding one around this time)')
    const sc = schedule?.[i]
    if (sc) {
      const leg = sc.sched.travelIn
      lines.push(`    Travel here: ${leg.minutes} min (${LEG_SOURCE[leg.source]}${leg.mode ? `, ${leg.mode === 'train' ? 'by train' : 'on foot'}` : ''})`)
      if (sc.fixedTime != null) {
        lines.push(`    FIXED TIME ${formatClock(sc.fixedTime)} (anchor)${sc.arriveEarlyMin ? `; must arrive ${sc.arriveEarlyMin} min early, by ${formatClock(sc.sched.arrival)}` : ''}`)
      }
      if (sc.sched.leaveBy != null) lines.push(`    Leave by: ${formatClock(sc.sched.leaveBy)}${sc.sched.nextIsAnchor ? ` (next stop has a fixed time; includes a ${LEAVE_BUFFER_MIN}-min buffer)` : ''}`)
      if (sc.sched.stayUntil != null) lines.push(`    Can stay until: ${formatClock(sc.sched.stayUntil)}`)
      if (sc.sched.doesntFit) lines.push(`    PROBLEM: can't reach the fixed-time stop [${sc.sched.doesntFit.anchorIndex}] at ${formatClock(sc.sched.doesntFit.anchorTime)} in time after this (${sc.sched.doesntFit.shortMin} min short)`)
      else if (sc.sched.leaveEarlierMin) lines.push(`    PROBLEM: ends ${sc.sched.leaveEarlierMin} min after its leave-by time`)
    }
    if (trainLines[i]) lines.push(`    Train here (chosen by the owner; the timetable above uses it): ${trainLines[i]}`)
    if (openingHoursByStop[i]) lines.push(`    Opening hours: ${openingHoursByStop[i]}`)
    if (notesByStop[i]) lines.push(`    Note from the trip owner (may contain real train route/fare — trust over the straight-line distance above): ${notesByStop[i]}`)
  })
  if (backAtBase) lines.push(`Back at the base: ~${formatClock(backAtBase.end)} (${backAtBase.minutes} min from the last stop).`)
  return lines.join('\n')
}

// Opening-hour problems for Check day, computed (lib/opening-hours.ts, the same check as the
// pages) rather than left to the model: one warning per stop that is closed that weekday, not
// open yet, closed already, or closes before you leave.
export function hoursReviewItems(names: string[], hours: Array<string | null>, weekday: number | null, visits: { start: number; end: number }[], date: string | null = null) {
  const items: { severity: 'warning'; stopIndex: number; message: string; suggestion: string | null }[] = []
  names.forEach((name, i) => {
    const c = checkHours(hours[i], weekday, visits[i].start, visits[i].end, date)
    if (!closedOnArrival(c) && c.kind !== 'closes-during') return
    const w = visitWarning(c)!
    items.push({ severity: 'warning', stopIndex: i, message: `${name}: ${w.message}`, suggestion: c.kind === 'closed-day' || c.kind === 'closed-date' ? 'Move it to another day.' : null })
  })
  return items
}

// The stops closed when you get there (the same check as the pages) — for the day warning.
export function closedStopIndexes(hours: Array<string | null>, weekday: number | null, visits: { start: number; end: number }[], date: string | null = null): number[] {
  return hours.map((h, i) => (closedOnArrival(checkHours(h, weekday, visits[i].start, visits[i].end, date)) ? i : -1)).filter((i) => i >= 0)
}

// The day warning for Check day — the same rule as the timeline and the list
// (itinerary-schedule.ts dayWarning: a late train back to the base, or closed stops) — and the
// other train legs after the last trains; computed, not left to the model.
export function dayWarningReviewItems(names: string[], sched: DaySchedule, closed: number[]) {
  const items: { severity: 'warning'; stopIndex: number | null; message: string; suggestion: string | null }[] = []
  const w = dayWarning(sched, closed)
  if (w) {
    const involved = w.involved.map((i) => `${names[i]} ${formatClock(sched.stops[i].start)}`).join(', ')
    items.push({ severity: 'warning', stopIndex: null, message: `${dayWarningMessages(w).join(' ')} (${involved})`, suggestion: 'Move them to another day.' })
  }
  for (const leg of lastTrainLegs(sched)) {
    const back = leg.index >= names.length
    if (back) continue // in the day warning above
    items.push({
      severity: 'warning',
      stopIndex: back ? names.length - 1 : leg.index,
      message: `${back ? 'The train back to the base' : `The train to ${names[leg.index]}`} at ${formatClock(leg.departs)}: ${LAST_TRAIN_MESSAGE}.`,
      suggestion: 'End the day earlier, or plan a taxi.',
    })
  }
  return items
}

// --- Check day's suggestions as changes that can be applied ----------------------------------
// The model may attach one action to an item, from this fixed list; the server checks it against
// the plan and drops it when it doesn't apply (the item's text stays). The page shows "Apply" on
// the ones left, never applies anything by itself.
export const REVIEW_ACTION_TYPES = ['set_leave_time', 'change_duration', 'move_position', 'move_day', 'remove_stop'] as const
export type ReviewAction =
  | { type: 'set_leave_time'; stopIndex: number; stopName: string; leaveAt: string }
  | { type: 'change_duration'; stopIndex: number; stopName: string; durationMin: number }
  | { type: 'move_position'; stopIndex: number; stopName: string; toIndex: number }
  | { type: 'move_day'; stopIndex: number; stopName: string; toDate: string }
  | { type: 'remove_stop'; stopIndex: number; stopName: string }
export type ReviewActionContext = {
  stops: { name: string; plannedTime: number; durationMin: number }[]
  dayDate: string | null
  tripDays: string[] // the trip's other days a stop can move to
}
const MIN_DURATION = 5, MAX_DURATION = 600
export function validateReviewAction(raw: any, stopIndex: number | null, ctx: ReviewActionContext): ReviewAction | null {
  if (!raw || typeof raw !== 'object' || !REVIEW_ACTION_TYPES.includes(raw.type)) return null
  const idx = typeof raw.stopIndex === 'number' ? raw.stopIndex : stopIndex
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= ctx.stops.length) return null
  const stop = ctx.stops[idx]
  const base = { stopIndex: idx, stopName: stop.name }
  switch (raw.type) {
    case 'set_leave_time': {
      const m = typeof raw.leaveAt === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.leaveAt.trim()) : null
      if (!m) return null
      let at = +m[1] * 60 + +m[2]
      if (at + 720 < stop.plannedTime) at += 1440 // an evening visit left after midnight
      if (at <= stop.plannedTime || at === stop.plannedTime + stop.durationMin) return null // before it starts, or no change
      return { type: 'set_leave_time', ...base, leaveAt: raw.leaveAt.trim() }
    }
    case 'change_duration': {
      const d = raw.durationMin
      if (typeof d !== 'number' || !Number.isInteger(d) || d < MIN_DURATION || d > MAX_DURATION || d === stop.durationMin) return null
      return { type: 'change_duration', ...base, durationMin: d }
    }
    case 'move_position': {
      const to = raw.toIndex
      if (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= ctx.stops.length || to === idx) return null
      return { type: 'move_position', ...base, toIndex: to }
    }
    case 'move_day': {
      const to = typeof raw.toDate === 'string' ? raw.toDate.trim() : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to === ctx.dayDate || !ctx.tripDays.includes(to)) return null
      return { type: 'move_day', ...base, toDate: to }
    }
    case 'remove_stop':
      return { type: 'remove_stop', ...base }
  }
  return null
}

// The model's items, checked: severity, message, stop and suggestion as before, and its action
// when it applies (validateReviewAction). At most `max`.
export type ModelReviewItem = { severity: string; stopIndex: number | null; message: string; suggestion: string | null; action?: ReviewAction }
export function modelReviewItems(parsed: unknown[], ctx: ReviewActionContext, max: number): ModelReviewItem[] {
  const items: ModelReviewItem[] = []
  for (const item of parsed as any[]) {
    if (!item || typeof item !== 'object') continue
    if (item.severity !== 'warning' && item.severity !== 'tip') continue
    const message = typeof item.message === 'string' && item.message.trim() ? item.message.trim().slice(0, 300) : ''
    if (!message) continue
    const stopIndex = typeof item.stopIndex === 'number' && Number.isInteger(item.stopIndex) && item.stopIndex >= 0 && item.stopIndex < ctx.stops.length ? item.stopIndex : null
    const suggestion = typeof item.suggestion === 'string' && item.suggestion.trim() ? item.suggestion.trim().slice(0, 300) : null
    // "Add <a stop the plan already has>": dropped (e.g. the day's own lunch place suggested again).
    if (suggestsAddingExisting(`${message} ${suggestion || ''}`, ctx.stops.map((s) => s.name))) continue
    const action = item.action != null ? validateReviewAction(item.action, stopIndex, ctx) : null
    items.push({ severity: item.severity, stopIndex, message, suggestion, ...(action ? { action } : {}) })
    if (items.length >= max) break
  }
  return items
}

// "Leave at 14:30", "Make it 45 min", "Move to place 3", "Move to 2026-12-07", "Remove it".
export function reviewActionLabel(a: ReviewAction): string {
  switch (a.type) {
    case 'set_leave_time': return `Leave at ${a.leaveAt}`
    case 'change_duration': return `Make it ${a.durationMin} min`
    case 'move_position': return `Move to place ${a.toIndex + 1}`
    case 'move_day': return `Move to ${a.toDate}`
    case 'remove_stop': return 'Remove it'
  }
}

// --- Meals -------------------------------------------------------------------------------------
// A stop is a meal when its shop's place type is restaurant, or its tag or its own note has one of
// these words (any case). Suggest route keeps meals at their time; Check day is told which they are.
export const MEAL_WORDS = ['mat', 'lunsj', 'lunch', 'middag', 'dinner', 'frokost', 'breakfast']
const MEAL_RE = new RegExp(`(^|[^\\p{L}])(${MEAL_WORDS.join('|')})([^\\p{L}]|$)`, 'iu')
export function isMealStop(s: { placeType?: string | null; tag?: string | null; note?: string | null }): boolean {
  return s.placeType === 'restaurant' || MEAL_RE.test(s.tag || '') || MEAL_RE.test(s.note || '')
}

// A suggestion to add a stop the day already has (the same shop or the same name), e.g. "add a
// lunch stop at Darumanome" when Darumanome Akihabara is stop 5: dropped by the server. A stop's
// name matches by any distinctive word (5+ letters, not an area or a common word).
const COMMON_NAME_WORDS = new Set(['akihabara', 'shinjuku', 'ikebukuro', 'shibuya', 'harajuku', 'nakano', 'yokohama', 'shinagawa', 'tokyo', 'station',
  'store', 'shop', 'shops', 'flagship', 'building', 'tower', 'cafe', 'square', 'enix', 'final', 'fantasy', 'marui', 'annex', 'ekimae', 'honten', 'branch', 'world'])
const ADD_RE = /\b(add|adding|include|insert|visit|stop (?:at|by)|eat at|have (?:lunch|dinner|breakfast) at|go to|try)\b/i
export function suggestsAddingExisting(text: string, stopNames: string[]): boolean {
  if (!ADD_RE.test(text)) return false
  const lower = text.toLowerCase()
  return stopNames.some((name) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 5 && !COMMON_NAME_WORDS.has(w) && lower.includes(w)))
}

// --- Check day on the server: the request, the schedule, and every check made without the AI ----
// The request (lib/itinerary-plan.ts checkDayRequestBody) → the day's stops and the timetable, from
// the same lib/itinerary-schedule.ts as the timeline (fixed times, arrive-early, typed-in travel,
// trains, leave times, waiting for openings) — nothing the client computed is trusted.
const validTrainOf = (raw: unknown): TrainPlan | null => {
  const v = raw ? validateTrain(raw) : null
  return v && 'train' in v ? v.train : null
}
export type ReviewInputs = {
  stops: ReviewStopInput[]
  notesByStop: (string | null)[]
  openingHoursByStop: (string | null)[]
  scheduleInputs: ScheduleStopInput[]
  startMin: number
  dayDate: string | null
  weekday: number | null
  flight: FlightHome | null
  daySchedule: DaySchedule | null
  schedule: ReviewScheduleStop[] | null
  airportTrain: { leaveBy: number; atAirport: number; summary: string } | null
}
export function reviewInputsFromBody(body: any): { error: string } | ReviewInputs {
  if (!Array.isArray(body?.stops) || body.stops.length === 0) return { error: 'Missing stops' }
  if (body.stops.length > 40) return { error: 'Too many stops' }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const stops: ReviewStopInput[] = []
  const notesByStop: (string | null)[] = []
  const openingHoursByStop: (string | null)[] = []
  for (const raw of body.stops) {
    const name = str(raw?.name, 200) || ''
    const plannedTime = typeof raw?.plannedTime === 'number' && isFinite(raw.plannedTime) ? raw.plannedTime : null
    const durationMin = typeof raw?.durationMin === 'number' && isFinite(raw.durationMin) ? raw.durationMin : null
    if (!name || plannedTime == null || durationMin == null) return { error: 'Invalid stop data' }
    const lat = typeof raw?.lat === 'number' && isFinite(raw.lat) ? raw.lat : null
    const lng = typeof raw?.lng === 'number' && isFinite(raw.lng) ? raw.lng : null
    // A meal: its place type, its tag or its own note (isMealStop).
    stops.push({ name, plannedTime, durationMin, lat, lng, meal: isMealStop({ placeType: str(raw?.placeType, 20), tag: str(raw?.tag, 40), note: str(raw?.ownNote, 500) }) })
    notesByStop.push(str(raw?.note, 500))
    openingHoursByStop.push(str(raw?.openingHours, 200))
  }
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
      actualStart: hhmm(raw?.actualStart),
      actualEnd: hhmm(raw?.actualEnd),
      leaveAt: hhmm(raw?.leaveAt),
      train: trainTimes(validTrainOf(raw?.train)),
      openingHours: openingHoursByStop[i],
    }
  })
  const flight = parseFlightHome(body.flight)
  const base = point(body.base)
  const startMin = hhmm(typeof body.dayStartTime === 'string' ? body.dayStartTime : null) ?? stops[0].plannedTime
  // The leg after the last stop: the airport train on the flight day, else a train back to the base.
  const airportPlan = flight ? validTrainOf(body.flight?.airportTrain) : null
  const airportTrainTimes: TrainTimes | null = airportPlan ? trainTimes(airportPlan) : null
  const returnTrainTimes = !airportTrainTimes ? trainTimes(validTrainOf(body.returnTrain)) : null
  const dayDate = isIsoDate(body.dayDate) ? body.dayDate : null
  const weekday = dayDate ? weekdayIndex(dayDate) : null
  const daySchedule = base ? scheduleDay(scheduleInputs, startMin, base, { returnTrain: airportTrainTimes || returnTrainTimes, weekday, date: dayDate }) : null
  const airportTrain = airportTrainTimes && airportPlan
    ? { leaveBy: trainLeaveBy(airportTrainTimes), atAirport: daySchedule ? daySchedule.end : airportTrainTimes.arrival + (airportTrainTimes.walkFromStationMin ?? 5), summary: trainSummary(airportPlan).replace(/^🚆 /, '') }
    : null
  const schedule: ReviewScheduleStop[] | null = daySchedule
    ? daySchedule.stops.map((sched, i) => ({ fixedTime: scheduleInputs[i].fixedTime, arriveEarlyMin: scheduleInputs[i].arriveEarlyMin, sched }))
    : null
  return { stops, notesByStop, openingHoursByStop, scheduleInputs, startMin, dayDate, weekday, flight, daySchedule, schedule, airportTrain }
}

// Every timing problem the server finds itself, before the AI is asked — listed first, marked
// `source: 'timetable'`: the day warning (late trains, closed stops), leave earlier / doesn't fit
// (a missed arrive-early, too little time to walk), the first fixed stop the day's start can't
// reach, waiting for an opening, opening hours, and the flight deadline.
export type ServerReviewItem = { severity: 'warning' | 'tip'; stopIndex: number | null; message: string; suggestion: string | null; source: 'timetable' }
export function serverReviewItems(inp: ReviewInputs): ServerReviewItem[] {
  const names = inp.stops.map((s) => s.name)
  const out: { severity: 'warning' | 'tip'; stopIndex: number | null; message: string; suggestion: string | null }[] = []
  const sched = inp.daySchedule
  const visits = inp.stops.map((s, i) => (sched ? { start: sched.stops[i].start, end: sched.stops[i].end } : { start: s.plannedTime, end: s.plannedTime + s.durationMin }))
  if (sched && inp.schedule) {
    const closedIdx = closedStopIndexes(inp.openingHoursByStop, inp.weekday, visits, inp.dayDate)
    out.push(...dayWarningReviewItems(names, sched, closedIdx))
    // The first stop has a fixed time the day's start can't reach (nothing before it to leave earlier).
    const first = sched.stops[0]
    if (first && first.fixed && inp.startMin + first.travelIn.minutes > first.arrival) {
      const need = first.arrival - first.travelIn.minutes
      const early = inp.scheduleInputs[0].arriveEarlyMin
      out.push({
        severity: 'warning', stopIndex: 0,
        message: `The day starts at ${formatClock(inp.startMin)}, too late to reach ${names[0]} by ${formatClock(first.arrival)}${early ? ` (${early} min before its ${formatClock(first.start)})` : ''} — ${first.travelIn.minutes} min to get there.`,
        suggestion: `Start the day by ${formatClock(need)}.`,
      })
    }
    out.push(...scheduleReviewItems(names, inp.schedule, sched.segments))
    sched.stops.forEach((x, i) => {
      if (x.waitMin) out.push({ severity: 'tip', stopIndex: i, message: `${names[i]}: you get there at ${formatClock(x.arrival)} and it opens at ${formatClock(x.start)} — ${x.waitMin} min waiting.`, suggestion: 'Start later, or visit something else first.' })
    })
  }
  out.push(...hoursReviewItems(names, inp.openingHoursByStop, inp.weekday, visits, inp.dayDate))
  const fw = inp.flight ? flightDeadlineWarning(inp.stops, inp.flight, sched ? sched.end : null, inp.airportTrain) : null
  if (fw) out.push(fw as any)
  return out.map((x) => ({ ...x, source: 'timetable' as const }))
}

// For the AI: what the timetable already found and the owner sees first — not to be repeated or
// contradicted.
export function alreadyListedText(items: { message: string }[]): string {
  if (!items.length) return ''
  return `\n\nALREADY LISTED for the owner by the timetable (computed exactly; don't repeat or contradict these):\n${items.map((x) => `- ${x.message}`).join('\n')}`
}
