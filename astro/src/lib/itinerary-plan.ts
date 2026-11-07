// The itinerary's plan in the browser: how the saved plan is loaded and saved, and how a day's
// stops become a timetable. Shared by /itinerary-list (the list) and /itinerary (the timeline), so both
// read and write the same data in the same format and show the same times. The timetable rules
// themselves are in itinerary-schedule.ts; this is the glue from saved stops to its inputs.
//
// Both pages' scripts are `is:inline` and reach this through a module script that puts it on
// `window.__routeOptimizer` (see itinerary-list.astro).

import { scheduleDay, dayWarning, type DaySchedule, type DayWarning, type ScheduleStopInput } from './itinerary-schedule'
import { extractNoteTravelMinutes, type RoutePoint } from './route-optimizer'
import { checkHours, visitWarning, closedOnArrival, closingTime } from './opening-hours'
import { isIsoDate, weekdayIndex, addDays } from './trip-dates'
import { trainTimes, validateTrain, yenWithNok, formatYen, DEFAULT_TRAVELERS, type TrainPlan } from './train-plan'
import { extractJpyTotal, latestEndForFlight, AIRPORTS, AIRPORT_ARRIVAL_BEFORE_MIN } from './itinerary-review-helpers'
import { trainLeaveBy } from './itinerary-schedule'
import { PLACE_TYPE_INFO } from './place-types'

export const DEFAULT_START = '08:00'
// The leg into a day's first stop starts at the base (travelFrom on that stop).
export const BASE_KEY = '__base__'

// A stop as saved in the plan. `shopId` links it to a shop note (whose name, coordinates and
// note win when set); `dur`, `fixedTime`, `arriveEarly`, `travelMin`/`travelFrom` are optional.
export type PlanStop = {
  name?: string
  hours?: string
  tag?: string
  slot?: string
  lat?: number | null
  lng?: number | null
  shopId?: string | null
  dur?: number | null
  fixedTime?: string | null
  arriveEarly?: number
  travelMin?: number
  travelFrom?: string
  note?: string
  actualStart?: string // "HH:MM", set by "I'm here now" on the timeline
  actualEnd?: string // "HH:MM", set by "Leaving now"
  leaveAt?: string // "HH:MM": "🚪 Leave at" — the visit ends then (itinerary-schedule.ts)
  train?: TrainPlan // "🚆 Plan train": the train on the leg INTO this stop (lib/train-plan.ts)
  [key: string]: unknown
}
export type PlanDay = {
  day: string; date: string; area: string; note: string; startTime: string; stops: PlanStop[]
  // Trains planned for the last legs (lib/train-plan.ts): back to the base, and on the flight day
  // from the base to the airport. Saved with the day.
  returnTrain?: TrainPlan
  airportTrain?: TrainPlan
  // The day's bases (dayBases): a shop's id (usually a hotel) or TRIP_BASE_KEY; unset = the
  // default (the start: the night before's end base; the end: the start).
  startBase?: string
  endBase?: string
}
export type PlanTemplateDay = { day: string; date: string; area: string; note?: string; stops: PlanStop[] }
export type PlanShop = {
  _id: string; shopName?: string; latitude?: number; longitude?: number; note?: string
  openingHours?: string | null
  address?: string | null; area?: string | null
  photos?: { caption?: string | null; url: string }[] | null // shopNote.photos (floor guides …)
  placeType?: string | null // shopNote.placeType (lib/place-types.ts): shop | restaurant | sight | hotel | other
}

// The shopNote schema's place type icons (sanity/schemaTypes/shopNote.ts). A shop saved without a
// type counts as a shop (its initial value), as on /prices; an unknown value as "other".
export const PLACE_TYPE_ICONS: Record<string, { icon: string; label: string }> = PLACE_TYPE_INFO
export function placeTypeIcon(shop: PlanShop | null | undefined): { icon: string; label: string } | null {
  if (!shop) return null
  return PLACE_TYPE_ICONS[shop.placeType || 'shop'] || PLACE_TYPE_ICONS.other
}
export type SavedDay = { startTime?: string; stops?: PlanStop[]; returnTrain?: TrainPlan; airportTrain?: TrainPlan; startBase?: string; endBase?: string }
export type SavedDays = Record<string, SavedDay>

export function parseClock(s: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === 'string' ? s : '')
  return m ? +m[1] * 60 + +m[2] : null
}

// Resolves the *effective* name/lat/lng for a stop: if it has a shopId, prefer the linked
// shop's current data, but only for fields the shop actually has — falls back to whatever's
// stored on the stop itself. This covers all three edge cases safely: shop deleted (lookup
// misses -> the stop's own fields), shop missing coords (falls back per field), and the shops
// list failing to load at all, e.g. offline (every lookup misses). Never returns a null name.
export function resolveStop(s: PlanStop, shopById: Map<string, PlanShop>): { name: string; lat: number | null; lng: number | null } {
  let name = s.name, lat = s.lat, lng = s.lng
  const shop = s.shopId ? shopById.get(s.shopId) : null
  if (shop) {
    if (shop.shopName) name = shop.shopName
    if (typeof shop.latitude === 'number') lat = shop.latitude
    if (typeof shop.longitude === 'number') lng = shop.longitude
  }
  return { name: name != null ? name : 'Ukjent butikk', lat: lat != null ? lat : null, lng: lng != null ? lng : null }
}

// The linked shop's own note (it may give the real travel time from Akihabara).
export function stopNote(s: PlanStop, shopById: Map<string, PlanShop>): string | null {
  if (!s.shopId) return null
  const shop = shopById.get(s.shopId)
  return shop && shop.note ? shop.note : null
}

export function defaultDurationMin(s: PlanStop): number {
  if (s.tag === 'mat') return 60
  if (s.tag === 'MUST') return 75
  if (s.tag === 'sett av tid') return 120
  if (s.slot === 'kveld') return 40
  return 45
}

// A travel time entered for the leg into stop si only counts while it's still the same leg:
// it remembers which stop it was entered after (travelFrom), so after a reorder it's ignored
// (kept in the saved plan, used again if the stops go back) rather than misapplied.
export function legFromKey(day: { stops: PlanStop[] }, si: number, shopById: Map<string, PlanShop>): string {
  return si === 0 ? BASE_KEY : resolveStop(day.stops[si - 1], shopById).name
}
export function manualTravelFor(day: { stops: PlanStop[] }, si: number, shopById: Map<string, PlanShop>): number | null {
  const s = day.stops[si]
  return typeof s.travelMin === 'number' && s.travelFrom === legFromKey(day, si, shopById) ? s.travelMin : null
}

// The day's timetable from the shared schedule (itinerary-schedule.ts): fixed-time stops are
// anchors, everything else runs forward, with leave-by times and warnings.
// `times`: each stop's start; `sched`: the full schedule; `inputs`: what it was computed from.
// `base`: the trip's base, or the day's own start and end bases (dayBases).
// The leg after the last stop: on the flight day with a train to the airport (airportTrain), that
// train — the day then ends at the airport; otherwise the trip back to the base (returnTrain, or
// the estimate). Without stops the airport train starts at the base (flightDeadline).
export function lastLegTrain(day: { stops: PlanStop[]; returnTrain?: TrainPlan; airportTrain?: TrainPlan }): { train: TrainPlan | undefined; toAirport: boolean } {
  if (day.stops.length && trainTimes(day.airportTrain)) return { train: day.airportTrain, toAirport: true }
  return { train: day.returnTrain, toAirport: false }
}
export function computeDayTimes(
  day: { startTime: string; stops: PlanStop[]; returnTrain?: TrainPlan; airportTrain?: TrainPlan },
  base: RoutePoint | { start: RoutePoint; end: RoutePoint },
  shopById: Map<string, PlanShop>
): { baseStart: number; times: number[]; baseEnd: number; sched: DaySchedule; inputs: ScheduleStopInput[] } {
  let start = parseClock(day.startTime)
  if (start == null) start = parseClock(DEFAULT_START)!
  const inputs: ScheduleStopInput[] = day.stops.map((s, si) => {
    const r = resolveStop(s, shopById)
    return {
      name: r.name, lat: r.lat, lng: r.lng,
      durationMin: s.dur != null ? s.dur : defaultDurationMin(s),
      fixedTime: s.fixedTime ? parseClock(s.fixedTime) : null,
      arriveEarlyMin: s.fixedTime && typeof s.arriveEarly === 'number' ? s.arriveEarly : null,
      manualTravelMin: manualTravelFor(day, si, shopById),
      noteTravelMin: extractNoteTravelMinutes(stopNote(s, shopById)),
      must: s.tag === 'MUST',
      actualStart: parseClock(s.actualStart),
      actualEnd: parseClock(s.actualEnd),
      leaveAt: parseClock(s.leaveAt),
      train: trainTimes(s.train),
    }
  })
  const startBase = 'start' in base ? base.start : base
  const endBase = 'start' in base ? base.end : base
  const sched = scheduleDay(inputs, start, startBase, { returnTrain: trainTimes(lastLegTrain(day).train), endBase })
  return { baseStart: start, times: sched.stops.map((x) => x.start), baseEnd: sched.end, sched, inputs }
}

// --- The saved plan ---------------------------------------------------------------------------
// Saved as { v: 2, days: { "YYYY-MM-DD": { startTime, stops } } }; an older save is an array
// with one entry per plan day in the plan's order (1.–7. des), so entry i is the i-th date.
export function normalizeSavedPlan(p: unknown, plan: { day: string }[]): SavedDays | null {
  if (Array.isArray(p)) {
    const out: SavedDays = {}
    p.forEach((d, i) => { if (d && plan[i]) out[plan[i].day] = d })
    return out
  }
  const v2 = p as { v?: number; days?: unknown } | null
  if (v2 && v2.v === 2 && v2.days && typeof v2.days === 'object') return v2.days as SavedDays
  return null
}

// One date's day: its saved version, else the plan's default for that date, else empty.
// `startDefaults`: a day's own default start instead of DEFAULT_START (the arrival day: after
// landing, lib/trip-plans.ts arrivalFor). Every save writes every day's start, so on such a day a
// saved DEFAULT_START counts as not chosen; any other saved time is kept.
export function planDayEntry(iso: string, s: SavedDay | undefined, templateByDay: Map<string, PlanTemplateDay>, labels: Record<string, string>, startDefaults: Record<string, string> = {}): PlanDay {
  const t = templateByDay.get(iso)
  const own = startDefaults[iso]
  const saved = s && s.startTime
  return {
    day: iso, date: labels[iso] || iso, area: t ? t.area : '', note: t ? t.note || '' : '',
    startTime: saved && !(own && saved === DEFAULT_START) ? saved : own || DEFAULT_START,
    ...(s && s.returnTrain ? { returnTrain: s.returnTrain } : {}),
    ...(s && s.airportTrain ? { airportTrain: s.airportTrain } : {}),
    ...(s && typeof s.startBase === 'string' && s.startBase ? { startBase: s.startBase } : {}),
    ...(s && typeof s.endBase === 'string' && s.endBase ? { endBase: s.endBase } : {}),
    stops: s && Array.isArray(s.stops) ? s.stops : t ? t.stops.slice() : [],
  }
}

// `state`: the trip's days, in order. `extraDays`: every other date with a plan (saved or
// default) — their stops are shown under "Not scheduled" until moved to a day.
export function buildPlanState(plan: PlanTemplateDay[], days: string[], labels: Record<string, string>, saved: SavedDays, startDefaults: Record<string, string> = {}): { state: PlanDay[]; extraDays: Record<string, PlanDay> } {
  const templateByDay = new Map(plan.map((d) => [d.day, d]))
  const inRange = new Set(days)
  const extraDays: Record<string, PlanDay> = {}
  new Set([...plan.map((d) => d.day), ...Object.keys(saved)]).forEach((iso) => {
    if (!inRange.has(iso)) extraDays[iso] = planDayEntry(iso, saved[iso], templateByDay, labels, startDefaults)
  })
  return { state: days.map((iso) => planDayEntry(iso, saved[iso], templateByDay, labels, startDefaults)), extraDays }
}

// The saved form of every date, the "Not scheduled" ones included — a stop is only ever removed
// by the user, never by the trip's days changing.
export function serializePlan(state: PlanDay[], extraDays: Record<string, PlanDay>): string {
  const all: SavedDays = {}
  Object.values(extraDays).concat(state).forEach((d) => {
    if (!d.day) return
    const saved: SavedDay = { startTime: d.startTime, stops: d.stops }
    // Only when there is one, so a plan without them saves exactly as before.
    if (d.returnTrain) saved.returnTrain = d.returnTrain
    if (d.airportTrain) saved.airportTrain = d.airportTrain
    if (d.startBase) saved.startBase = d.startBase
    if (d.endBase) saved.endBase = d.endBase
    all[d.day] = saved
  })
  return JSON.stringify({ v: 2, days: all })
}

// --- Adding a stop (the list's "+ Legg til stopp" and the timeline's tap-to-add) -----------------
// The shop pickers' list (add a stop, link to a shop, the day's base): shops grouped by area, the
// areas A–Z and the shops A–Z in each, each with its index in `shops`. The selected trip's shops
// (shopNote.trips) are marked "🧳 " in their area — no group of their own.
export const TRIP_SHOP_MARK = '🧳 '
export function shopOptionGroups(shops: { shopName?: string; area?: string; latitude?: number; longitude?: number; tripIds?: string[] | null }[], tripId: string | null = null): { area: string; items: { i: number; name: string; hasCoord: boolean; onTrip: boolean }[] }[] {
  const byArea: Record<string, { i: number; name: string; hasCoord: boolean; onTrip: boolean; sortName: string }[]> = {}
  shops.forEach((s, i) => {
    const onTrip = !!tripId && Array.isArray(s.tripIds) && s.tripIds.includes(tripId)
    const area = s.area || 'Andre'
    if (!byArea[area]) byArea[area] = []
    byArea[area].push({ i, name: (onTrip ? TRIP_SHOP_MARK : '') + (s.shopName || ''), sortName: s.shopName || '', onTrip, hasCoord: typeof s.latitude === 'number' && typeof s.longitude === 'number' })
  })
  const byName = (a: { sortName: string }, b: { sortName: string }) => a.sortName.localeCompare(b.sortName, 'en', { sensitivity: 'base' })
  return Object.keys(byArea).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map((area) => ({ area, items: byArea[area].sort(byName).map(({ sortName, ...item }) => item) }))
}

// A stop for a shop from the shop list, or one typed in by hand — the same saved shape on both pages.
export function shopStopFrom(shop: { _id?: string; shopName?: string; openingHours?: string; placeType?: string; latitude?: number; longitude?: number }): PlanStop {
  return {
    name: shop.shopName,
    hours: shop.openingHours || '',
    tag: shop.placeType === 'restaurant' ? 'mat' : '',
    slot: '',
    shopId: shop._id || null,
    lat: typeof shop.latitude === 'number' ? shop.latitude : null,
    lng: typeof shop.longitude === 'number' ? shop.longitude : null,
  }
}
export function customStopFrom(name: string, hours: string): PlanStop {
  return { name, hours, tag: '', slot: '', lat: null, lng: null }
}

// --- A day's Google Maps route, "Check day" request and "Suggest route" input -----------------
// Shared by /itinerary-list and /itinerary (exactly what the list used to build inline).

// Walking directions base -> the stops with coordinates, in order -> base; split into parts of
// at most 10 points (Google Maps' limit), each part starting where the previous one ended.
export function dayRouteUrls(points: { lat: number | null; lng: number | null }[], base: { lat: number; lng: number }): string[] {
  const pts = points.filter((s) => s.lat != null && s.lng != null).map((s) => `${s.lat},${s.lng}`)
  const baseP = `${base.lat},${base.lng}`
  const full = [baseP, ...pts, baseP]
  if (full.length < 2) return []
  const MAX = 10, segs: string[][] = []
  if (full.length <= MAX) segs.push(full)
  else { let i = 0; while (i < full.length - 1) { segs.push(full.slice(i, i + MAX)); i += MAX - 1 } }
  return segs.map((seg) => {
    const origin = seg[0], destination = seg[seg.length - 1]
    const waypoints = seg.slice(1, -1).join('|')
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`
    return url
  })
}

// The body /api/itinerary-review gets for one day (it recomputes the timetable from it).
export function checkDayRequestBody(
  day: PlanDay,
  ctx: { base: { lat: number; lng: number }; shopById: Map<string, PlanShop>; flight: { date: string; time: string; airport: string; terminal?: string } | null }
) {
  const { times, sched } = computeDayTimes(day, ctx.base, ctx.shopById)
  const stops = day.stops.map((s, si) => {
    const r = resolveStop(s, ctx.shopById)
    return {
      name: r.name,
      plannedTime: times[si],
      // A leave time sets the length; the review recomputes it from leaveAt too.
      durationMin: s.leaveAt ? sched.stops[si].end - sched.stops[si].start : s.dur != null ? s.dur : defaultDurationMin(s),
      leaveAt: s.leaveAt || null,
      train: s.train || null,
      lat: r.lat,
      lng: r.lng,
      openingHours: stopHoursText(s, ctx.shopById).text || null,
      note: stopNote(s, ctx.shopById),
      fixedTime: s.fixedTime || null,
      arriveEarlyMin: s.fixedTime && typeof s.arriveEarly === 'number' ? s.arriveEarly : null,
      manualTravelMin: manualTravelFor(day, si, ctx.shopById),
      must: s.tag === 'MUST',
      actualStart: s.actualStart || null,
      actualEnd: s.actualEnd || null,
    }
  })
  const flight = ctx.flight
  return {
    dayDate: day.day,
    dayLabel: day.date,
    dayArea: day.area,
    dayStartTime: day.startTime,
    base: { lat: ctx.base.lat, lng: ctx.base.lng },
    // Only on the day the flight home leaves — the review checks the day against it.
    // … with its train to the airport, when one is planned: the deadline then follows that train.
    flight: flight && flight.date === day.day ? { time: flight.time, airport: flight.airport, terminal: flight.terminal, ...(day.airportTrain ? { airportTrain: day.airportTrain } : {}) } : undefined,
    // The train back to the base (not on a day that ends at the airport).
    ...(day.returnTrain && !lastLegTrain(day).toAirport ? { returnTrain: day.returnTrain } : {}),
    stops,
  }
}

// What the route optimizer (route-optimizer.ts optimizeRoute) needs for one day.
export function optimizerInput(day: PlanDay, ctx: { base: { lat: number | null; lng: number | null }; shopById: Map<string, PlanShop> }) {
  const startTime = parseClock(day.startTime)
  const start = typeof ctx.base.lat === 'number' && typeof ctx.base.lng === 'number' ? { lat: ctx.base.lat, lng: ctx.base.lng } : null
  const stops = day.stops.map((s, i) => {
    const r = resolveStop(s, ctx.shopById)
    const train = trainTimes(s.train)
    return {
      lat: r.lat,
      lng: r.lng,
      durationMin: s.dur != null ? s.dur : defaultDurationMin(s),
      fixedTime: s.fixedTime ? parseClock(s.fixedTime) : null,
      openingHours: stopHoursText(s, ctx.shopById).text || null,
      note: stopNote(s, ctx.shopById),
      leaveAt: parseClock(s.leaveAt),
      train,
      // A train leg stays intact: the stop after it and the stop before it keep their places.
      locked: !!train || !!trainTimes(day.stops[i + 1]?.train),
    }
  })
  return { stops, startTime: startTime != null ? startTime : parseClock(DEFAULT_START)!, start, weekday: dayWeekday(day.day), date: isIsoDate(day.day) ? day.day : null }
}

// --- Editing a stop: the list's ⋯ menu, ▲▼ and ✕, and the timeline's edit sheet ---------------
// Each changes the day in place; the page then saves and re-renders as usual.

// "lat, lng" (or "lat lng") as pasted from Google Maps; null when it isn't a valid pair.
export function parseLatLng(str: string | null | undefined): { lat: number; lng: number } | null {
  const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(str || '')
  if (!m) return null
  const lat = parseFloat(m[1]), lng = parseFloat(m[2])
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

// One place up (delta -1) or down (+1); false when it's already first/last.
export function moveStopBy(day: { stops: PlanStop[] }, idx: number, delta: number): boolean {
  const arr = day.stops, ni = idx + delta
  if (ni < 0 || ni >= arr.length) return false
  ;[arr[idx], arr[ni]] = [arr[ni], arr[idx]]
  return true
}
// To the end of another day.
export function moveStopToDay(from: { stops: PlanStop[] }, idx: number, to: { stops: PlanStop[] }): void {
  const [s] = from.stops.splice(idx, 1)
  to.stops.push(s)
}
export function copyStopToDay(from: { stops: PlanStop[] }, idx: number, to: { stops: PlanStop[] }): void {
  to.stops.push({ ...from.stops[idx] })
}
export function removeStop(day: { stops: PlanStop[] }, idx: number): void {
  day.stops.splice(idx, 1)
}

// Minutes as typed; anything that isn't a number clears it (back to the default length).
export function setStopDuration(stop: PlanStop, raw: string): void {
  const v = parseInt(raw, 10)
  stop.dur = isNaN(v) ? null : v
}
export function setArriveEarly(stop: PlanStop, raw: string): void {
  const v = parseInt(raw, 10)
  if (isNaN(v) || v <= 0) delete stop.arriveEarly
  else stop.arriveEarly = v
}

// Order the day by time: fixed-time stops at their time, the others where the timetable puts
// them (ties keep their order) — done after a fixed time is set or changed.
export function resortByTime(day: PlanDay, base: RoutePoint, shopById: Map<string, PlanShop>): void {
  const { times } = computeDayTimes(day, base, shopById)
  const withT = day.stops.map((s, i) => ({
    s, orig: i,
    t: s.fixedTime && parseClock(s.fixedTime) != null ? parseClock(s.fixedTime)! : times[i],
  }))
  withT.sort((a, b) => a.t - b.t || a.orig - b.orig)
  day.stops = withT.map((x) => x.s)
}
// "HH:MM" pins the stop to that time ('' unpins it), then the day is re-sorted.
export function setFixedTime(day: PlanDay, idx: number, value: string, base: RoutePoint, shopById: Map<string, PlanShop>): void {
  day.stops[idx].fixedTime = value || null
  resortByTime(day, base, shopById)
}

// --- Actual times ("I'm here now" / "Leaving now" on the timeline) ----------------------------
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
// Arrived now: the visit starts now (a later "I'm here now" starts it again).
export function markHereNow(stop: PlanStop, nowMin: number): void {
  stop.actualStart = hhmm(nowMin)
  delete stop.actualEnd
}
// Leaving now: the visit ends now; one never marked as arrived started when it was planned to.
export function markLeavingNow(stop: PlanStop, nowMin: number, plannedStart: number): void {
  if (!stop.actualStart) stop.actualStart = hhmm(Math.min(plannedStart, nowMin))
  stop.actualEnd = hhmm(nowMin)
}
// "Reset day": every stop back to its planned times.
export function clearActualTimes(day: { stops: PlanStop[] }): void {
  day.stops.forEach((s) => { delete s.actualStart; delete s.actualEnd })
}
export function hasActualTimes(day: { stops: PlanStop[] }): boolean {
  return day.stops.some((s) => !!s.actualStart || !!s.actualEnd)
}

// --- Opening hours on a stop (lib/opening-hours.ts) -------------------------------------------
// The hours a stop is checked against: its linked shop's (kept current on the shop's page),
// else the text on the stop itself — for a stop written by hand that's often a note
// ("Lunsj · kontant") rather than hours.
export function stopHoursText(s: PlanStop, shopById: Map<string, PlanShop>): { text: string; fromShop: boolean } {
  const shop = s.shopId ? shopById.get(s.shopId) : undefined
  const shopHours = shop && typeof shop.openingHours === 'string' ? shop.openingHours.trim() : ''
  if (shopHours) return { text: shopHours, fromShop: true }
  return { text: typeof s.hours === 'string' ? s.hours.trim() : '', fromShop: false }
}
// The day's weekday (0 = Sunday), or null for a day without a date.
export function dayWeekday(iso: unknown): number | null {
  return isIsoDate(iso) ? weekdayIndex(iso) : null
}
// Text that is meant as opening hours: a shop's, or one with a time in it — so a hand-written
// note doesn't get "Hours not understood".
const looksLikeHours = (text: string) => /\d{1,2}\s*[:：時.]\s*\d{0,2}|\d\s*[-–~〜]\s*\d|24|døgn|closed|stengt|定休/i.test(text)

// Visiting `s` from `start` to `end` on the day `dayIso`: "Closed on Tuesday", "Opens 11:00
// (you arrive 09:00)", "Closes 22:00 (you leave 22:08)" … with a short badge for the timeline;
// or the note "Hours not understood" (`note`). null when there's nothing to say.
export function stopHoursWarning(s: PlanStop, shopById: Map<string, PlanShop>, dayIso: string, start: number, end: number): { badge: string; message: string; note?: boolean } | null {
  const { text, fromShop } = stopHoursText(s, shopById)
  const w = visitWarning(checkHours(text, dayWeekday(dayIso), start, end, isIsoDate(dayIso) ? dayIso : null))
  if (w?.note && !fromShop && !looksLikeHours(text)) return null
  return w
}
// The same for hours text not on a stop yet (adding one): the warning, or null.
export function hoursWarningAt(text: string | null | undefined, dayIso: string, start: number, end: number) {
  const c = checkHours(text, dayWeekday(dayIso), start, end, isIsoDate(dayIso) ? dayIso : null)
  return closedOnArrival(c) || c.kind === 'closes-during' ? visitWarning(c) : null
}

// The stops closed when you get there on their day (opening hours on the day's weekday and date).
export function closedStops(day: PlanDay, sched: DaySchedule, shopById: Map<string, PlanShop>): number[] {
  const date = isIsoDate(day.day) ? day.day : null
  return day.stops
    .map((s, i) => (closedOnArrival(checkHours(stopHoursText(s, shopById).text, dayWeekday(day.day), sched.stops[i].start, sched.stops[i].end, date)) ? i : -1))
    .filter((i) => i >= 0)
}
// The day's warning (itinerary-schedule.ts dayWarning): a late train back to the base, or closed stops.
export function dayWarningFor(day: PlanDay, sched: DaySchedule, shopById: Map<string, PlanShop>): DayWarning | null {
  return dayWarning(sched, closedStops(day, sched, shopById))
}

// The areas a day visits, in visiting order without repeats ("Akihabara · Shinjuku · Yokohama"):
// each linked shop's area. A day whose stops have none shows the plan's own area for the day,
// as the list (/itinerary-list) does.
export function dayAreas(day: PlanDay, shopById: Map<string, PlanShop>): string[] {
  const out: string[] = []
  for (const s of day.stops) {
    const area = s.shopId ? shopById.get(s.shopId)?.area : null
    if (area && !out.includes(area)) out.push(area)
  }
  return out.length ? out : day.area ? [day.area] : []
}

// "🚪 Leave at": "HH:MM" sets it, anything else (or '') clears it.
export function setLeaveAt(stop: PlanStop, value: string): void {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim())
  if (m && +m[1] < 24 && +m[2] < 60) stop.leaveAt = `${m[1].padStart(2, '0')}:${m[2]}`
  else delete stop.leaveAt
}
// "Until closing": when the stop's shop closes on its day, from the visit's start (the end of the
// opening stretch you're in, or of the next one) — null when unknown or open around the clock.
export function closingTimeFor(s: PlanStop, shopById: Map<string, PlanShop>, dayIso: string, start: number): number | null {
  return closingTime(stopHoursText(s, shopById).text, dayWeekday(dayIso), start, isIsoDate(dayIso) ? dayIso : null)
}

// The day's train fares per person: each planned train's fare, plus for a leg by train without a
// planned one the fares in its shop's note (as Check day counts them). An estimate when any train
// leg has only a note fare or no fare at all (a planned train without one, or the trip back by
// train). null when the day has no train legs.
// The trains back to the base and to the airport count like any other planned train. `groupYen`:
// each fare × its travelers (the train's own number, else the trip's, else DEFAULT_TRAVELERS);
// `travelers`: that number when every fare counted has the same, else null.
export type DayTrainFares = { totalYen: number; groupYen: number; travelers: number | null; estimate: boolean }
export function dayTrainFares(day: PlanDay, sched: DaySchedule, shopById: Map<string, PlanShop>, tripTravelers: number | null = null): DayTrainFares | null {
  const tripN = tripTravelers ?? DEFAULT_TRAVELERS
  let totalYen = 0, groupYen = 0, estimate = false, legs = 0
  const counts = new Set<number>()
  // A planned train: its fare (or, without one, an estimate). false when it isn't a valid train.
  const planned = (t: unknown): boolean => {
    const v = t ? validateTrain(t) : null
    if (!v || !('train' in v)) return false
    legs++
    const n = v.train.travelers ?? tripN
    if (v.train.fareYen) { totalYen += v.train.fareYen; groupYen += v.train.fareYen * n; counts.add(n) }
    else estimate = true
    return true
  }
  day.stops.forEach((s, i) => {
    if (planned(s.train)) return
    if (sched.stops[i]?.travelIn.mode === 'train') {
      legs++
      estimate = true
      const fare = extractJpyTotal([stopNote(s, shopById)])
      totalYen += fare
      groupYen += fare * tripN
      if (fare) counts.add(tripN)
    }
  })
  if (!planned(day.returnTrain) && sched.returnLeg?.mode === 'train') { legs++; estimate = true }
  planned(day.airportTrain)
  return legs ? { totalYen, groupYen, travelers: counts.size === 0 ? tripN : counts.size === 1 ? [...counts][0] : null, estimate } : null
}
// "🚆 Trains today: ¥7,340 per person (≈ 470 kr) · ¥36,700 for 5 · estimate"; '' without fares.
export function dayTrainFaresText(f: DayTrainFares | null, rate: number | null | undefined): string {
  if (!f || !f.totalYen) return ''
  const group = `${formatYen(f.groupYen)} ${f.travelers != null ? `for ${f.travelers}` : 'for everyone'}`
  return `🚆 Trains today: ${yenWithNok(f.totalYen, rate).replace(/^(¥[\d,]+)/, '$1 per person')} · ${group}${f.estimate ? ' · estimate' : ''}`
}

// The flight day's deadline. Without a train to the airport: leave the base by
// latestEndForFlight (as before). With one (day.airportTrain): leave by its leave-by — the last
// stop then (the train is the leg after it), the base on a day without stops; `late` when it
// reaches the airport (its arrival + the walk) after check-in closes (the flight −
// AIRPORT_ARRIVAL_BEFORE_MIN). null on other days.
export type FlightDeadline = { leaveBy: number; train: boolean; atAirport: number | null; checkInBy: number; late: boolean }
export function flightDeadline(day: { day: string; airportTrain?: TrainPlan }, flight: { date: string; time: string; airport: string } | null): FlightDeadline | null {
  if (!flight || flight.date !== day.day || !(flight.airport in AIRPORTS)) return null
  const m = /^(\d{2}):(\d{2})$/.exec(flight.time)
  if (!m) return null
  const checkInBy = +m[1] * 60 + +m[2] - AIRPORT_ARRIVAL_BEFORE_MIN
  const t = trainTimes(day.airportTrain)
  if (!t) return { leaveBy: latestEndForFlight(flight), train: false, atAirport: null, checkInBy, late: false }
  const atAirport = t.arrival + t.walkFromStationMin
  return { leaveBy: trainLeaveBy(t), train: true, atAirport, checkInBy, late: atAirport > checkInBy }
}

// "Latest: HH:MM" and "Fix: leave at HH:MM": the latest stop idx can be left and still be on time
// for what comes after it — the next anchor (fixed time, arrive-early, train: the schedule's
// latestLeave, the same as "You can stay until"), else on the flight-home day the time to leave
// for the airport (`flightLatest`, itinerary-review-helpers.ts latestEndForFlight) less the rest of
// the day and the trip back to the base. null when nothing after it has a deadline, or it's left.
export function latestLeaveFor(sched: DaySchedule, idx: number, flightLatest: number | null = null): number | null {
  const x = sched.stops[idx]
  if (!x || x.visited) return null
  if (x.latestLeave != null) return x.latestLeave
  if (flightLatest == null) return null
  let t = flightLatest - (sched.returnLeg?.minutes ?? 0)
  for (let k = sched.stops.length - 1; k > idx; k--) t -= (sched.stops[k].end - sched.stops[k].start) + sched.stops[k].travelIn.minutes
  return t
}
// The one-tap fix for a stop's "Doesn't fit" / "Leave N min earlier": leave it at latestLeaveFor —
// only when that is after the visit starts (otherwise leaving earlier can't fix it). null otherwise.
export function leaveFixFor(sched: DaySchedule, idx: number, flightLatest: number | null = null): number | null {
  const x = sched.stops[idx]
  if (!x || !(x.doesntFit || x.leaveEarlierMin)) return null
  const t = latestLeaveFor(sched, idx, flightLatest)
  return t != null && t > x.start ? t : null
}

// --- A base per day (hotels) ----------------------------------------------------------------
// Each day starts at its start base and ends at its end base: a shop (usually a 🏨 hotel) or the
// trip's base. Unset: the start is where the day before ended (the first day: the trip's base),
// the end is the start. A trip that never sets one keeps its single base.
export const TRIP_BASE_KEY = '__trip__'
export type DayBase = RoutePoint & { name: string; key: string }
export type DayBases = { start: DayBase; end: DayBase; changes: boolean }
export function dayBases(days: { day: string; startBase?: string; endBase?: string }[], tripBase: { name?: string; lat: number | null; lng: number | null }, shopById: Map<string, PlanShop>): Map<string, DayBases> {
  // Named plainly "Base" in lines like "🏨 Base → Hotel B" (the trip's own label is longer).
  const trip: DayBase = { name: 'Base', lat: tripBase.lat, lng: tripBase.lng, key: TRIP_BASE_KEY }
  // A shop without coordinates still names the base, but the trips are timed from the trip's base.
  const resolve = (key: string | undefined): DayBase | null => {
    if (!key) return null
    if (key === TRIP_BASE_KEY) return trip
    const shop = shopById.get(key)
    if (!shop) return null
    const has = typeof shop.latitude === 'number' && typeof shop.longitude === 'number'
    return { name: shop.shopName || 'Base', lat: has ? shop.latitude! : trip.lat, lng: has ? shop.longitude! : trip.lng, key }
  }
  const out = new Map<string, DayBases>()
  let before = trip
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const start = resolve(d.startBase) || before
    const end = resolve(d.endBase) || start
    out.set(d.day, { start, end, changes: start.key !== end.key })
    before = end
  }
  return out
}
// "🏨 Hotel A → Hotel B" for a day that changes base; '' otherwise.
export function dayBasesLine(b: DayBases | undefined): string {
  return b && b.changes ? `🏨 ${b.start.name} → ${b.end.name}` : ''
}

// --- "🚆 Plan train": when to search -----------------------------------------------------------
// The leg into stop `idx` ('stop'), back to the base ('return') or to the airport ('airport'):
// arriving by the next anchor (a fixed time less its arrive-early; the airport's check-in), else
// departing when the stop before is left (its leave-by; the day's start for the first leg; the
// last visit's end for the trip back). Minutes past midnight move to the next date.
export function legSearchTime(
  day: { day: string; stops: PlanStop[] },
  sched: DaySchedule,
  idx: number,
  kind: 'stop' | 'return' | 'airport',
  ctx: { baseStart: number; checkInBy?: number | null },
): { date: string; minutes: number; type: 'depart' | 'arrive' } {
  const at = (minutes: number, type: 'depart' | 'arrive') => {
    const shift = Math.floor(minutes / 1440)
    return { date: shift ? addDays(day.day, shift) : day.day, minutes: ((minutes % 1440) + 1440) % 1440, type }
  }
  if (kind === 'airport' && ctx.checkInBy != null) return at(ctx.checkInBy, 'arrive')
  const last = sched.stops[sched.stops.length - 1]
  if (kind !== 'stop') return at(last ? last.end : ctx.baseStart, 'depart')
  const next = day.stops[idx]
  const fixed = next ? parseClock(next.fixedTime) : null
  if (fixed != null) return at(fixed - (typeof next.arriveEarly === 'number' ? Math.max(0, next.arriveEarly) : 0), 'arrive')
  const before = idx > 0 ? sched.stops[idx - 1] : null
  return at(before ? before.leaveBy ?? before.end : ctx.baseStart, 'depart')
}
