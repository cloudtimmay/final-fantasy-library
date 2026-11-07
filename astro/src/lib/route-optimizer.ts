// Pure, dependency-free deterministic route optimizer for the itinerary page's
// "🧭 Suggest route" feature — no AI involved, just arithmetic and search. Kept as its own
// module so it's directly unit-testable; itinerary-list.astro's main script is `is:inline`
// (left untouched, far too large/load-bearing to safely convert to a module) and can't
// import it directly, so a tiny separate `<script type="module">` in that file imports
// this and exposes it as `window.__routeOptimizer` for the inline script to call.
//
// Opening hours come from lib/opening-hours.ts, the one parser every page uses.

import { checkHours, closedOnArrival, closingTime } from './opening-hours'

export type RoutePoint = { lat: number | null; lng: number | null }

export type OptimizerStop = {
  lat: number | null
  lng: number | null
  durationMin: number
  fixedTime: number | null // minutes since midnight, or null if this stop isn't pinned
  openingHours: string | null // free text, e.g. "10:00–20:00, closed Tue"
  note: string | null // the shop's own note — may contain a real travel time from Akihabara
  leaveAt?: number | null // "Leave at": the visit ends then (itinerary-schedule.ts)
  // A planned train on the leg INTO this stop (lib/train-plan.ts trainTimes): you arrive with it.
  train?: { departure: number; arrival: number; walkToStationMin?: number | null; walkFromStationMin?: number | null } | null
  // Stays in its position, like a fixed-time stop: the stops on both sides of a train leg, so the
  // leg stays intact (the same two stops, in that order, next to each other).
  locked?: boolean
}

// Matches itinerary-schedule.ts (TRAIN_PLATFORM_MIN / TRAIN_EXIT_WALK_MIN; that module imports
// this one, so the numbers are repeated here rather than imported).
const TRAIN_PLATFORM_MIN = 10
const TRAIN_EXIT_WALK_MIN = 5

export type RouteSchedule = {
  times: number[] // planned start time (minutes since midnight) per stop, in `order`
  travelMin: number
  waitMin: number
  closedCount: number
  score: number
}

// A stop the opening-hours heuristic couldn't place anywhere it's open (listed, not placed closed):
// `closes` is its closing time that day when known ("Couldn't fit: X (closes 20:00)").
export type Unplaced = { index: number; closes: number | null }

export type OptimizeResult = {
  order: number[] // original indices, in the suggested order (stops that couldn't fit last)
  unplaced: Unplaced[]
  currentOrder: number[] // original indices, in today's (unchanged) order — for comparison
  suggested: RouteSchedule
  current: RouteSchedule
  usedFirstStopAsStart: boolean
  improved: boolean // true if the suggested order scores strictly better than the current one
}

// ---- Travel time estimate ----

// Walking: the route is about 1.4× the straight line through Tokyo's streets, at a relaxed
// shopping pace of 80 m/min (~4.8 km/h).
export const WALK_ROUTE_FACTOR = 1.4
export const WALK_M_PER_MIN = 80

// Train, fitted to Tokyo rail: a fixed overhead for walking to and from the stations and
// waiting (trains every few minutes, often one change), then about 1.1 min per straight-line
// km — commuter and rapid lines cover longer distances at 50–60 km/h. Checked against known
// trips (straight-line distance -> estimate -> real-world):
//   Akihabara -> Ikebukuro        6.6 km -> 27 min (about 25–30)
//   Yokohama  -> Hiroo/Minami-Azabu 22.5 km -> 45 min (about 45–60)
//   Shinjuku  -> Yokohama         25.9 km -> 48 min (about 35–45: the direct Shōnan-Shinjuku
//                                                    line is faster than a straight line can know)
// No straight-line formula fits both of the last two (the longer trip is the quicker one), so
// this errs toward too much time rather than a missed train. A travel time entered for a leg,
// or a shop note's, always wins over this estimate (lib/itinerary-schedule.ts).
export const TRAIN_OVERHEAD_MIN = 20
export const TRAIN_MIN_PER_KM = 1.1

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Extracts a travel time in minutes from a shop's own note, e.g. "Take the Ginza line,
// about 25 min from Akihabara (¥180)" -> 25. Only meaningful for a leg touching the day's
// start/base location, since the note describes travel "from Akihabara" specifically, not
// from whatever the previous stop happens to be.
export function extractNoteTravelMinutes(note: string | null | undefined): number | null {
  if (!note) return null
  const m = /(\d+)\s*min/i.exec(note)
  return m ? Number(m[1]) : null
}

// The quicker of walking and the train estimate above, in whole minutes (at least 1);
// null when either end has no coordinates.
export function estimateLeg(a: RoutePoint, b: RoutePoint): { minutes: number; mode: 'walk' | 'train' } | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const km = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng })
  const walk = (km * 1000 * WALK_ROUTE_FACTOR) / WALK_M_PER_MIN
  const train = TRAIN_OVERHEAD_MIN + km * TRAIN_MIN_PER_KM
  return walk <= train ? { minutes: Math.max(1, Math.round(walk)), mode: 'walk' } : { minutes: Math.round(train), mode: 'train' }
}

export function estimateTravelMinutes(a: RoutePoint, b: RoutePoint, preferMinutes?: number | null): number {
  if (preferMinutes != null) return preferMinutes
  return estimateLeg(a, b)?.minutes ?? 0
}

// Large enough that the search always prefers zero closed-shop arrivals over any amount
// of travel/waiting savings, but still finite so comparing two all-closed candidates (both
// bad) is meaningful rather than a tie.
const CLOSED_PENALTY_MIN = 500

// Walks a full stop order from `start`, computing each stop's planned time, accumulating
// travel/waiting minutes and closed-shop arrivals, and scoring the result. A fixed-time
// stop's own arrival is asserted (the clock jumps to it, no travel added to the total —
// "stays at its time" per the feature's own rule); the stop AFTER it still travels
// normally from its location.
function computeSchedule(order: OptimizerStop[], startTime: number, start: RoutePoint, weekday: number | null = null, date: string | null = null): RouteSchedule {
  let clock = startTime
  let prevPoint: RoutePoint = start
  let travelMin = 0
  let waitMin = 0
  let closedCount = 0
  const times: number[] = []

  order.forEach((stop, i) => {
    if (stop.train) {
      // The planned train: missing it (still busy at its leave-by) costs like a closed shop.
      const leaveBy = stop.train.departure - TRAIN_PLATFORM_MIN - Math.max(0, stop.train.walkToStationMin || 0)
      if (clock > leaveBy) closedCount++
      clock = stop.fixedTime != null ? stop.fixedTime : stop.train.arrival + (stop.train.walkFromStationMin ?? TRAIN_EXIT_WALK_MIN)
    } else if (stop.fixedTime != null) {
      // The trip there counts, and getting there after its time is missing it (like a closed shop)
      // — so an order that puts too much before a fixed stop scores badly.
      const travel = estimateTravelMinutes(prevPoint, stop, i === 0 ? extractNoteTravelMinutes(stop.note) : null)
      travelMin += travel
      if (clock + travel > stop.fixedTime) closedCount++
      clock = stop.fixedTime
    } else {
      const preferMinutes = i === 0 ? extractNoteTravelMinutes(stop.note) : null
      const travel = estimateTravelMinutes(prevPoint, stop, preferMinutes)
      clock += travel
      travelMin += travel
    }
    // Closed when you get there (closed that weekday, not open yet, or closed already): the
    // large penalty. Not open yet also counts the wait (lib/opening-hours.ts).
    const leaveAt = stop.leaveAt != null ? (stop.leaveAt + 720 < clock ? stop.leaveAt + 1440 : stop.leaveAt) : null
    const ends = leaveAt != null ? Math.max(clock, leaveAt) : clock + stop.durationMin
    const hours = checkHours(stop.openingHours, weekday, clock, ends, date)
    if (hours.kind === 'before-open') waitMin += hours.opens - clock
    if (closedOnArrival(hours)) closedCount++
    times.push(clock)
    clock = ends
    prevPoint = { lat: stop.lat, lng: stop.lng }
  })

  const score = travelMin + waitMin + closedCount * CLOSED_PENALTY_MIN
  return { times, travelMin, waitMin, closedCount, score }
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const result: T[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const perm of permutations(rest)) result.push([item, ...perm])
  })
  return result
}

// Up to this many stops to move, every order is tried, the anchors placed by time
// (exhaustiveByTime); more: the opening-hours heuristic (insertionOrder).
const BRUTE_FORCE_LIMIT = 6

// Small days: every order of the movable stops, with the anchors placed among them by time, not by
// their place in the list — each anchor unit (a fixed-time stop; the two stops of a train leg, kept
// together and in order) can come anywhere, the units keeping their own order; the computed
// schedule (a missed fixed time or train costs like a closed shop) decides. A fixed 20:00 stop
// second in the list can so have five shops before it. Above MAX_EXHAUSTIVE_SCHEDULES (orders ×
// placements), the opening-hours heuristic instead.
const MAX_EXHAUSTIVE_SCHEDULES = 60000

// The anchors as units, in their list order: a train stop together with the locked stop before it.
function anchorUnits(stops: OptimizerStop[], anchorIdx: number[]): number[][] {
  const units: number[][] = []
  for (const i of anchorIdx) {
    const prev = units[units.length - 1]
    if (stops[i].train && prev && prev[prev.length - 1] === i - 1) prev.push(i)
    else units.push([i])
  }
  return units
}
// Every interleaving of `a` (the movable stops, in one order) with the units (in theirs).
function interleavings(a: number[], units: number[][]): number[][] {
  if (!units.length) return [a]
  if (!a.length) return [units.flat()]
  return [
    ...interleavings(a.slice(1), units).map((rest) => [a[0], ...rest]),
    ...interleavings(a, units.slice(1)).map((rest) => [...units[0], ...rest]),
  ]
}
function binomial(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
function exhaustiveByTime(stops: OptimizerStop[], anchorIdx: number[], movableIdx: number[], startTime: number, start: RoutePoint, weekday: number | null, date: string | null): number[] | null {
  const units = anchorUnits(stops, anchorIdx)
  const perms = permutations(movableIdx)
  if (perms.length * binomial(movableIdx.length + units.length, units.length) > MAX_EXHAUSTIVE_SCHEDULES) return null
  let best: number[] | null = null
  let bestScore = Infinity
  for (const perm of perms) {
    for (const order of interleavings(perm, units)) {
      const score = computeSchedule(order.map((i) => stops[i]), startTime, start, weekday, date).score
      if (score < bestScore) { bestScore = score; best = order }
    }
  }
  return best
}

// --- The opening-hours heuristic (days with more than BRUTE_FORCE_LIMIT stops to move) ----------
// The anchors (fixed-time stops, the stops of a train leg) keep their order and times; the other
// stops are inserted one by one, earliest-closing first, where each is open for its whole visit
// (waiting for the opening is fine), every anchor after it is still reached in time, and the day
// ends by `endBy` (the flight home), choosing the place that adds the least travel and waiting —
// earlier gaps between anchors first. A stop with no such place is left out (`unplaced`), never
// put where it's closed.
const LATER_SEGMENT_MIN = 15 // the cost of each anchor further on, so earlier gaps fill first

type Sim = { feasible: boolean; travelMin: number; waitMin: number; times: number[] }
function simulateFeasible(order: OptimizerStop[], movable: boolean[], startTime: number, start: RoutePoint, weekday: number | null, date: string | null, endBy: number | null): Sim {
  let clock = startTime
  let prev: RoutePoint = start
  let travelMin = 0, waitMin = 0
  const times: number[] = []
  for (let i = 0; i < order.length; i++) {
    const stop = order[i]
    if (stop.train) {
      const leaveBy = stop.train.departure - TRAIN_PLATFORM_MIN - Math.max(0, stop.train.walkToStationMin || 0)
      if (clock > leaveBy) return { feasible: false, travelMin, waitMin, times }
      clock = stop.fixedTime != null ? stop.fixedTime : stop.train.arrival + (stop.train.walkFromStationMin ?? TRAIN_EXIT_WALK_MIN)
    } else {
      const travel = estimateTravelMinutes(prev, stop, i === 0 ? extractNoteTravelMinutes(stop.note) : null)
      travelMin += travel
      clock += travel
      if (stop.fixedTime != null) {
        if (clock > stop.fixedTime) return { feasible: false, travelMin, waitMin, times }
        clock = stop.fixedTime
      }
    }
    if (movable[i]) {
      let hours = checkHours(stop.openingHours, weekday, clock, clock + stop.durationMin, date)
      if (hours.kind === 'before-open') {
        waitMin += hours.opens - clock
        clock = hours.opens
        hours = checkHours(stop.openingHours, weekday, clock, clock + stop.durationMin, date)
      }
      if (closedOnArrival(hours) || hours.kind === 'closes-during') return { feasible: false, travelMin, waitMin, times }
    }
    times.push(clock)
    const leaveAt = stop.leaveAt != null ? (stop.leaveAt + 720 < clock ? stop.leaveAt + 1440 : stop.leaveAt) : null
    clock = leaveAt != null ? Math.max(clock, leaveAt) : clock + stop.durationMin
    prev = { lat: stop.lat, lng: stop.lng }
  }
  if (endBy != null && clock > endBy) return { feasible: false, travelMin, waitMin, times }
  return { feasible: true, travelMin, waitMin, times }
}

function insertionOrder(stops: OptimizerStop[], anchorIdx: number[], movableIdx: number[], startTime: number, start: RoutePoint, weekday: number | null, date: string | null, endBy: number | null): { order: number[]; unplaced: Unplaced[]; times: number[] } {
  // Its closing time that day (the first opening stretch from midnight): the order to insert in, and
  // the reason shown for a stop that couldn't fit.
  const closesOf = (i: number) => closingTime(stops[i].openingHours, weekday, 0, date)
  const queue = movableIdx.slice().sort((a, b) => (closesOf(a) ?? Infinity) - (closesOf(b) ?? Infinity) || a - b)
  let route = anchorIdx.slice()
  const unplaced: Unplaced[] = []
  const sim = (r: number[]) => simulateFeasible(r.map((i) => stops[i]), r.map((i) => movableIdx.includes(i)), startTime, start, weekday, date, endBy)
  for (const m of queue) {
    let best: { route: number[]; cost: number } | null = null
    for (let p = 0; p <= route.length; p++) {
      // Never between the two stops of a train leg (the leg into a stop with a train).
      if (p < route.length && stops[route[p]].train && p > 0) continue
      const cand = [...route.slice(0, p), m, ...route.slice(p)]
      const s = sim(cand)
      if (!s.feasible) continue
      const anchorsBefore = route.slice(0, p).filter((i) => anchorIdx.includes(i)).length
      const cost = s.travelMin + s.waitMin + anchorsBefore * LATER_SEGMENT_MIN
      if (!best || cost < best.cost) best = { route: cand, cost }
    }
    if (best) route = best.route
    else unplaced.push({ index: m, closes: closesOf(m) })
  }
  return { order: [...route, ...unplaced.map((u) => u.index)], unplaced, times: sim(route).times }
}

// Finds the best order for one day's stops, starting and ending at `start`. Fixed-time stops
// and train legs keep their times and their order among themselves; the other stops are placed
// around them by time (exhaustiveByTime on small days, insertionOrder on full ones).
// `start` is the day's configured start location (e.g. the hotel/base); if it has no
// coordinates, the first stop's own location is used instead and `usedFirstStopAsStart`
// is set so the caller can say so.
// `weekday`: the day's (0 = Sunday, lib/trip-dates.ts weekdayIndex), so closed days and weekday
// hours count; null when the day has no date.
// `date`: the day itself ("YYYY-MM-DD"), for hours on given dates only.
// `endBy`: on the flight day, when the day must end (the time to leave for the airport).
export function optimizeRoute(stops: OptimizerStop[], startTime: number, start: RoutePoint | null, weekday: number | null = null, date: string | null = null, endBy: number | null = null): OptimizeResult {
  const currentOrder = stops.map((_, i) => i)
  const hasStart = !!start && start.lat != null && start.lng != null
  const usedFirstStopAsStart = !hasStart && stops.length > 0
  const effectiveStart: RoutePoint = hasStart ? (start as RoutePoint) : stops.length > 0 ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: null, lng: null }

  const current = computeSchedule(stops, startTime, effectiveStart, weekday, date)

  if (stops.length === 0) {
    return { order: [], unplaced: [], currentOrder, suggested: current, current, usedFirstStopAsStart, improved: false }
  }

  // Fixed-time stops and the stops of a train leg keep their places; the rest are ordered around them.
  const stays = (i: number) => stops[i].fixedTime != null || !!stops[i].locked
  const fixedIdx = currentOrder.filter(stays)
  const movableIdx = currentOrder.filter((i) => !stays(i))
  const byTime = movableIdx.length <= BRUTE_FORCE_LIMIT ? exhaustiveByTime(stops, fixedIdx, movableIdx, startTime, effectiveStart, weekday, date) : null
  if (!byTime) {
    // The opening-hours heuristic: anchors keep their order, the others go where they're open.
    const h = insertionOrder(stops, fixedIdx, movableIdx, startTime, effectiveStart, weekday, date, endBy)
    const scored = computeSchedule(h.order.map((i) => stops[i]), startTime, effectiveStart, weekday, date)
    // The times shown: with the waits for opening (the stops that couldn't fit: as scheduled after).
    const suggested = { ...scored, times: [...h.times, ...scored.times.slice(h.times.length)] }
    const changed = h.order.some((i, pos) => i !== currentOrder[pos])
    return { order: h.order, unplaced: h.unplaced, currentOrder, suggested, current, usedFirstStopAsStart, improved: changed && (suggested.score < current.score || h.unplaced.length < stops.length) }
  }
  const order = byTime
  const suggested = computeSchedule(order.map((i) => stops[i]), startTime, effectiveStart, weekday, date)

  return {
    order,
    unplaced: [],
    currentOrder,
    suggested,
    current,
    usedFirstStopAsStart,
    improved: suggested.score < current.score,
  }
}
