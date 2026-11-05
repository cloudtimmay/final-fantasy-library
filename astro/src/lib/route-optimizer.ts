// Pure, dependency-free deterministic route optimizer for the itinerary page's
// "🧭 Suggest route" feature — no AI involved, just arithmetic and search. Kept as its own
// module so it's directly unit-testable; itinerary-list.astro's main script is `is:inline`
// (left untouched, far too large/load-bearing to safely convert to a module) and can't
// import it directly, so a tiny separate `<script type="module">` in that file imports
// this and exposes it as `window.__routeOptimizer` for the inline script to call.
//
// Opening hours come from lib/opening-hours.ts, the one parser every page uses.

import { checkHours, closedOnArrival } from './opening-hours'

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

export type OptimizeResult = {
  order: number[] // original indices, in the suggested order
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

const BRUTE_FORCE_LIMIT = 8

// Finds the best order for the movable (non-fixed-time) stops, leaving every fixed-time
// stop in its original structural position — "plan the others around them". Up to
// BRUTE_FORCE_LIMIT movable stops, every ordering is tried; beyond that, a nearest-
// neighbour construction followed by 2-opt improvement is used instead, since the full
// permutation space becomes impractically large.
function bestMovableOrder(stops: OptimizerStop[], movableIdx: number[], fixedSlotsOrder: number[], startTime: number, start: RoutePoint, weekday: number | null, date: string | null): number[] {
  if (movableIdx.length === 0) return []

  function assembleFullOrder(movablePermutation: number[]): number[] {
    const full: number[] = new Array(stops.length)
    fixedSlotsOrder.forEach((origIdx) => { full[origIdx] = origIdx })
    let m = 0
    for (let pos = 0; pos < stops.length; pos++) {
      if (full[pos] === undefined) full[pos] = movablePermutation[m++]
    }
    return full
  }
  function scoreOf(movablePermutation: number[]): number {
    const full = assembleFullOrder(movablePermutation)
    return computeSchedule(full.map((i) => stops[i]), startTime, start, weekday, date).score
  }

  if (movableIdx.length <= BRUTE_FORCE_LIMIT) {
    let best = movableIdx
    let bestScore = Infinity
    for (const perm of permutations(movableIdx)) {
      const s = scoreOf(perm)
      if (s < bestScore) { bestScore = s; best = perm }
    }
    return best
  }

  // Nearest-neighbour construction, starting from `start`.
  const remaining = new Set(movableIdx)
  let order: number[] = []
  let cursor: RoutePoint = start
  while (remaining.size > 0) {
    let nearest: number | null = null
    let nearestDist = Infinity
    for (const idx of remaining) {
      const stop = stops[idx]
      const d = cursor.lat != null && cursor.lng != null && stop.lat != null && stop.lng != null
        ? haversineKm({ lat: cursor.lat, lng: cursor.lng }, { lat: stop.lat, lng: stop.lng })
        : 0
      if (d < nearestDist) { nearestDist = d; nearest = idx }
    }
    order.push(nearest as number)
    remaining.delete(nearest as number)
    cursor = { lat: stops[nearest as number].lat, lng: stops[nearest as number].lng }
  }

  // 2-opt: repeatedly try swapping every pair of positions, keep any swap that improves
  // the full schedule's score, until a full pass makes no improvement.
  let improved = true
  let bestScore = scoreOf(order)
  while (improved) {
    improved = false
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = order.slice()
        ;[candidate[i], candidate[j]] = [candidate[j], candidate[i]]
        const s = scoreOf(candidate)
        if (s < bestScore) { bestScore = s; order = candidate; improved = true }
      }
    }
  }
  return order
}

// Finds the best order for one day's stops, starting and ending at `start`. Fixed-time
// stops never move from their original position; only the other stops are reordered.
// `start` is the day's configured start location (e.g. the hotel/base); if it has no
// coordinates, the first stop's own location is used instead and `usedFirstStopAsStart`
// is set so the caller can say so.
// `weekday`: the day's (0 = Sunday, lib/trip-dates.ts weekdayIndex), so closed days and weekday
// hours count; null when the day has no date.
// `date`: the day itself ("YYYY-MM-DD"), for hours on given dates only.
export function optimizeRoute(stops: OptimizerStop[], startTime: number, start: RoutePoint | null, weekday: number | null = null, date: string | null = null): OptimizeResult {
  const currentOrder = stops.map((_, i) => i)
  const hasStart = !!start && start.lat != null && start.lng != null
  const usedFirstStopAsStart = !hasStart && stops.length > 0
  const effectiveStart: RoutePoint = hasStart ? (start as RoutePoint) : stops.length > 0 ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: null, lng: null }

  const current = computeSchedule(stops, startTime, effectiveStart, weekday, date)

  if (stops.length === 0) {
    return { order: [], currentOrder, suggested: current, current, usedFirstStopAsStart, improved: false }
  }

  // Fixed-time stops and the stops of a train leg keep their places; the rest are ordered around them.
  const stays = (i: number) => stops[i].fixedTime != null || !!stops[i].locked
  const fixedIdx = currentOrder.filter(stays)
  const movableIdx = currentOrder.filter((i) => !stays(i))
  const bestMovable = bestMovableOrder(stops, movableIdx, fixedIdx, startTime, effectiveStart, weekday, date)

  const order: number[] = new Array(stops.length)
  fixedIdx.forEach((i) => { order[i] = i })
  let m = 0
  for (let pos = 0; pos < stops.length; pos++) {
    if (order[pos] === undefined) order[pos] = bestMovable[m++]
  }

  const suggested = computeSchedule(order.map((i) => stops[i]), startTime, effectiveStart, weekday, date)

  return {
    order,
    currentOrder,
    suggested,
    current,
    usedFirstStopAsStart,
    improved: suggested.score < current.score,
  }
}
