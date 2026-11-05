// The itinerary's plan in the browser: how the saved plan is loaded and saved, and how a day's
// stops become a timetable. Shared by /itinerary-list (the list) and /itinerary (the timeline), so both
// read and write the same data in the same format and show the same times. The timetable rules
// themselves are in itinerary-schedule.ts; this is the glue from saved stops to its inputs.
//
// Both pages' scripts are `is:inline` and reach this through a module script that puts it on
// `window.__routeOptimizer` (see itinerary-list.astro).

import { scheduleDay, dayWarning, type DaySchedule, type DayWarning, type ScheduleStopInput } from './itinerary-schedule'
import { extractNoteTravelMinutes, type RoutePoint } from './route-optimizer'
import { checkHours, visitWarning, closedOnArrival } from './opening-hours'
import { isIsoDate, weekdayIndex } from './trip-dates'

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
  [key: string]: unknown
}
export type PlanDay = { day: string; date: string; area: string; note: string; startTime: string; stops: PlanStop[] }
export type PlanTemplateDay = { day: string; date: string; area: string; note?: string; stops: PlanStop[] }
export type PlanShop = {
  _id: string; shopName?: string; latitude?: number; longitude?: number; note?: string
  openingHours?: string | null
  address?: string | null; area?: string | null
  photos?: { caption?: string | null; url: string }[] | null // shopNote.photos (floor guides …)
}
export type SavedDays = Record<string, { startTime?: string; stops?: PlanStop[] }>

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
export function computeDayTimes(
  day: { startTime: string; stops: PlanStop[] },
  base: RoutePoint,
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
    }
  })
  const sched = scheduleDay(inputs, start, base)
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
export function planDayEntry(iso: string, s: { startTime?: string; stops?: PlanStop[] } | undefined, templateByDay: Map<string, PlanTemplateDay>, labels: Record<string, string>): PlanDay {
  const t = templateByDay.get(iso)
  return {
    day: iso, date: labels[iso] || iso, area: t ? t.area : '', note: t ? t.note || '' : '',
    startTime: (s && s.startTime) || DEFAULT_START,
    stops: s && Array.isArray(s.stops) ? s.stops : t ? t.stops.slice() : [],
  }
}

// `state`: the trip's days, in order. `extraDays`: every other date with a plan (saved or
// default) — their stops are shown under "Not scheduled" until moved to a day.
export function buildPlanState(plan: PlanTemplateDay[], days: string[], labels: Record<string, string>, saved: SavedDays): { state: PlanDay[]; extraDays: Record<string, PlanDay> } {
  const templateByDay = new Map(plan.map((d) => [d.day, d]))
  const inRange = new Set(days)
  const extraDays: Record<string, PlanDay> = {}
  new Set([...plan.map((d) => d.day), ...Object.keys(saved)]).forEach((iso) => {
    if (!inRange.has(iso)) extraDays[iso] = planDayEntry(iso, saved[iso], templateByDay, labels)
  })
  return { state: days.map((iso) => planDayEntry(iso, saved[iso], templateByDay, labels)), extraDays }
}

// The saved form of every date, the "Not scheduled" ones included — a stop is only ever removed
// by the user, never by the trip's days changing.
export function serializePlan(state: PlanDay[], extraDays: Record<string, PlanDay>): string {
  const all: SavedDays = {}
  Object.values(extraDays).concat(state).forEach((d) => { if (d.day) all[d.day] = { startTime: d.startTime, stops: d.stops } })
  return JSON.stringify({ v: 2, days: all })
}

// --- Adding a stop (the list's "+ Legg til stopp" and the timeline's tap-to-add) -----------------
// The shop picker's list: shops grouped by area (sorted), each with its index in `shops`.
export function shopOptionGroups(shops: { shopName?: string; area?: string; latitude?: number; longitude?: number }[]): { area: string; items: { i: number; name: string; hasCoord: boolean }[] }[] {
  const byArea: Record<string, { i: number; name: string; hasCoord: boolean }[]> = {}
  shops.forEach((s, i) => {
    const area = s.area || 'Andre'
    if (!byArea[area]) byArea[area] = []
    byArea[area].push({ i, name: s.shopName || '', hasCoord: typeof s.latitude === 'number' && typeof s.longitude === 'number' })
  })
  return Object.keys(byArea).sort().map((area) => ({ area, items: byArea[area] }))
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
  const { times } = computeDayTimes(day, ctx.base, ctx.shopById)
  const stops = day.stops.map((s, si) => {
    const r = resolveStop(s, ctx.shopById)
    return {
      name: r.name,
      plannedTime: times[si],
      durationMin: s.dur != null ? s.dur : defaultDurationMin(s),
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
    flight: flight && flight.date === day.day ? { time: flight.time, airport: flight.airport, terminal: flight.terminal } : undefined,
    stops,
  }
}

// What the route optimizer (route-optimizer.ts optimizeRoute) needs for one day.
export function optimizerInput(day: PlanDay, ctx: { base: { lat: number | null; lng: number | null }; shopById: Map<string, PlanShop> }) {
  const startTime = parseClock(day.startTime)
  const start = typeof ctx.base.lat === 'number' && typeof ctx.base.lng === 'number' ? { lat: ctx.base.lat, lng: ctx.base.lng } : null
  const stops = day.stops.map((s) => {
    const r = resolveStop(s, ctx.shopById)
    return {
      lat: r.lat,
      lng: r.lng,
      durationMin: s.dur != null ? s.dur : defaultDurationMin(s),
      fixedTime: s.fixedTime ? parseClock(s.fixedTime) : null,
      openingHours: stopHoursText(s, ctx.shopById).text || null,
      note: stopNote(s, ctx.shopById),
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
