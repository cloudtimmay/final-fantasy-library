// The itinerary's plan in the browser: how the saved plan is loaded and saved, and how a day's
// stops become a timetable. Shared by /itinerary (the list) and /itinerary-timeline, so both
// read and write the same data in the same format and show the same times. The timetable rules
// themselves are in itinerary-schedule.ts; this is the glue from saved stops to its inputs.
//
// Both pages' scripts are `is:inline` and reach this through a module script that puts it on
// `window.__routeOptimizer` (see itinerary.astro).

import { scheduleDay, type DaySchedule, type ScheduleStopInput } from './itinerary-schedule'
import { extractNoteTravelMinutes, parseOpeningHours, looksClosed, type RoutePoint } from './route-optimizer'

export { parseOpeningHours, looksClosed }

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
  shopId?: string
  dur?: number | null
  fixedTime?: string | null
  arriveEarly?: number
  travelMin?: number
  travelFrom?: string
  [key: string]: unknown
}
export type PlanDay = { day: string; date: string; area: string; note: string; startTime: string; stops: PlanStop[] }
export type PlanTemplateDay = { day: string; date: string; area: string; note?: string; stops: PlanStop[] }
export type PlanShop = { _id: string; shopName?: string; latitude?: number; longitude?: number; note?: string }
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
