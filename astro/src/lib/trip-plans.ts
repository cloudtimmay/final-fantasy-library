// Several trips, each with its own itinerary plan (/itinerary and /itinerary-list).
//
// The plan used to be one document, `itineraryState` ({ data: <JSON string>, updatedAt }). It
// stays exactly as it is and keeps belonging to the December 2026 trip: never migrated or
// rewritten into another shape. Every other trip gets its own document,
// `itineraryState-<tripId>`, created by its first save.
//
// Which trip owns the original document (ownsOriginalPlan): a trip whose days in Tokyo both fall
// in December 2026 — or, as before trips had their own plans, no trip at all / a trip without
// Tokyo days (the page then shows the plan's own December days, as it always has).
import { isIsoDate } from './trip-dates'

export const ORIGINAL_PLAN_DOC_ID = 'itineraryState'
export const ORIGINAL_PLAN_MONTH = '2026-12'
const TRIP_ID = /^[A-Za-z0-9_-]{1,128}$/

export type PlanTrip = {
  _id: string
  label?: string | null
  startDate?: string | null
  endDate?: string | null
  firstTokyoDay?: string | null
  lastTokyoDay?: string | null
  arrivalDate?: string | null
  arrivalTime?: string | null
  arrivalAirport?: string | null
  flightHomeDate?: string | null
  flightHomeTime?: string | null
  flightHomeAirport?: string | null
}

// The days in Tokyo, entered once: an empty "First day in Tokyo" is the arrival flight's date, an
// empty "Last day in Tokyo" the flight home's. Days filled in are kept as they are.
export function withFlightDays<T extends PlanTrip>(t: T): T {
  return {
    ...t,
    firstTokyoDay: isIsoDate(t.firstTokyoDay) ? t.firstTokyoDay : isIsoDate(t.arrivalDate) ? t.arrivalDate : t.firstTokyoDay ?? null,
    lastTokyoDay: isIsoDate(t.lastTokyoDay) ? t.lastTokyoDay : isIsoDate(t.flightHomeDate) ? t.flightHomeDate : t.lastTokyoDay ?? null,
  }
}

export const hasTokyoDays = (t: PlanTrip | null | undefined): boolean =>
  !!t && isIsoDate(t.firstTokyoDay) && isIsoDate(t.lastTokyoDay) && t.firstTokyoDay! <= t.lastTokyoDay!

export function ownsOriginalPlan(t: PlanTrip | null | undefined): boolean {
  if (!t || !hasTokyoDays(t)) return true
  return t.firstTokyoDay!.startsWith(ORIGINAL_PLAN_MONTH) && t.lastTokyoDay!.startsWith(ORIGINAL_PLAN_MONTH)
}

// The plan document a trip reads and writes.
export function planDocIdFor(t: PlanTrip | null | undefined): string {
  if (ownsOriginalPlan(t) || !TRIP_ID.test(t!._id)) return ORIGINAL_PLAN_DOC_ID
  return `${ORIGINAL_PLAN_DOC_ID}-${t!._id}`
}

// The document /api/itinerary-save writes: the original one exactly as before ({ _id, _type,
// data, updatedAt }); another trip's with a (weak) reference to its trip.
export function planSaveDoc(t: PlanTrip | null, data: string, now: Date = new Date()) {
  const _id = planDocIdFor(t)
  const doc: Record<string, unknown> = { _id, _type: 'itineraryState', data, updatedAt: now.toISOString() }
  if (_id !== ORIGINAL_PLAN_DOC_ID) doc.trip = { _type: 'reference', _ref: t!._id, _weak: true }
  return doc
}

// The browser's own copy of the plan (localStorage): the original key for the original plan, so
// nothing changes for it; one key per document for the others.
export function planStoreKey(baseKey: string, t: PlanTrip | null | undefined): string {
  const id = planDocIdFor(t)
  return id === ORIGINAL_PLAN_DOC_ID ? baseKey : `${baseKey}:${id}`
}

// The trip switcher's trips: those with days in Tokyo, in date order.
export function planTrips<T extends PlanTrip>(trips: T[]): T[] {
  return trips.filter(hasTokyoDays).sort((a, b) => a.firstTokyoDay!.localeCompare(b.firstTokyoDay!) || a._id.localeCompare(b._id))
}

// --- The arrival in Japan ------------------------------------------------------------------
// On the arrival day the day starts after landing + immigration and baggage + the trip from the
// airport to the base (Akihabara).
export const ARRIVAL_IMMIGRATION_MIN = 90
export const AIRPORT_TO_BASE_MIN: Record<string, number> = { Narita: 75, Haneda: 40 }
export const AIRPORT_NAMES: Record<string, string> = { Narita: 'Narita International Airport', Haneda: 'Haneda Airport' }
// Where a day starts or ends at an airport (the 🏨 Base picker, the arrival day): the terminals'
// stations — Haneda Airport Terminal 3, Narita Airport Terminal 1.
export const AIRPORT_POINTS: Record<string, { lat: number; lng: number }> = { Haneda: { lat: 35.5494, lng: 139.7798 }, Narita: { lat: 35.7720, lng: 140.3929 } }

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const parseHhmm = (s: unknown): number | null => {
  const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim()) : null
  return m ? +m[1] * 60 + +m[2] : null
}

export type Arrival = { date: string; time: string; airport: string; airportName: string; start: string; line: string }
// null without a landing time or a known airport; the date defaults to the first day in Tokyo.
export function arrivalFor(t: PlanTrip | null | undefined): Arrival | null {
  if (!t) return null
  const landing = parseHhmm(t.arrivalTime)
  const airport = t.arrivalAirport || ''
  const date = isIsoDate(t.arrivalDate) ? t.arrivalDate! : isIsoDate(t.firstTokyoDay) ? t.firstTokyoDay! : null
  if (landing == null || !(airport in AIRPORT_TO_BASE_MIN) || !date) return null
  // The day starts at the airport after immigration and baggage; the trip from there is its first leg.
  const start = landing + ARRIVAL_IMMIGRATION_MIN
  return {
    date, time: clock(landing), airport, airportName: AIRPORT_NAMES[airport],
    // Past midnight it would be the next day: the day starts at 23:59 at the latest.
    start: start >= 1440 ? '23:59' : clock(start),
    line: `✈️ Landing ${clock(landing)} at ${AIRPORT_NAMES[airport]}`,
  }
}

// --- Shops for a trip ----------------------------------------------------------------------
// The trip's shops first (shopNote.trips), then the rest, each part in its existing order.
export function shopsTripFirst<T extends { tripIds?: string[] | null }>(shops: T[], tripId: string | null | undefined): T[] {
  if (!tripId) return shops.slice()
  const on = (s: T) => Array.isArray(s.tripIds) && s.tripIds.includes(tripId)
  return [...shops.filter(on), ...shops.filter((s) => !on(s))]
}

// --- The homepage countdown ----------------------------------------------------------------
// Each trip with both its arrival in Japan and its flight home: the two moments as absolute
// times (written in Japan time, +09:00). The page counts down to the landing, then to the flight
// home, of the first trip whose flight home is still ahead.
export type CountdownTrip = { label: string; arrive: string; leave: string }
export function countdownTrips(trips: PlanTrip[]): CountdownTrip[] {
  const out: CountdownTrip[] = []
  for (const t of trips) {
    const landing = parseHhmm(t.arrivalTime)
    const flight = parseHhmm(t.flightHomeTime)
    const arriveDate = isIsoDate(t.arrivalDate) ? t.arrivalDate : isIsoDate(t.firstTokyoDay) ? t.firstTokyoDay : null
    const leaveDate = isIsoDate(t.flightHomeDate) ? t.flightHomeDate : isIsoDate(t.lastTokyoDay) ? t.lastTokyoDay : null
    if (landing == null || flight == null || !arriveDate || !leaveDate) continue
    out.push({ label: t.label || 'Trip', arrive: `${arriveDate}T${clock(landing)}:00+09:00`, leave: `${leaveDate}T${clock(flight)}:00+09:00` })
  }
  return out.sort((a, b) => a.arrive.localeCompare(b.arrive))
}
// The trip to count down to at `now`: the first whose flight home is still ahead.
export function nextCountdown(trips: CountdownTrip[], now: Date): CountdownTrip | null {
  return trips.find((t) => new Date(t.leave).getTime() > now.getTime()) || null
}
