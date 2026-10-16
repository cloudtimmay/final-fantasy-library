// Pure, dependency-free deterministic route optimizer for the itinerary page's
// "🧭 Suggest route" feature — no AI involved, just arithmetic and search. Kept as its own
// module so it's directly unit-testable; itinerary.astro's main script is `is:inline`
// (left untouched, far too large/load-bearing to safely convert to a module) and can't
// import it directly, so a tiny separate `<script type="module">` in that file imports
// this and exposes it as `window.__routeOptimizer` for the inline script to call.
//
// Opening-hours parsing below is a deliberate, hand-kept-in-sync duplicate of
// itinerary.astro's own parseOpeningHours/looksClosed (same reason shop-info.ts and
// itinerary-review.ts each keep their own copy too) — see that file's comment for the
// exact format rules this must match.

export type RoutePoint = { lat: number | null; lng: number | null }

export type OptimizerStop = {
  lat: number | null
  lng: number | null
  durationMin: number
  fixedTime: number | null // minutes since midnight, or null if this stop isn't pinned
  openingHours: string | null // free text, e.g. "10:00–20:00, closed Tue"
  note: string | null // the shop's own note — may contain a real travel time from Akihabara
}

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

// ---- Opening hours (see itinerary.astro's parseOpeningHours for the authoritative copy) ----

export function parseOpeningHours(text: string | null | undefined): { start: number; end: number } | null {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(String(text || ''))
  if (!m) return null
  const h1 = +m[1], min1 = +m[2], h2 = +m[3], min2 = +m[4]
  if (h1 > 23 || h2 > 23 || min1 > 59 || min2 > 59) return null
  const start = h1 * 60 + min1
  let end = h2 * 60 + min2
  if (end < start) {
    if (end < 360) end += 1440
    else return null
  }
  return { start, end }
}

export function looksClosed(hoursText: string | null | undefined, plannedMinutes: number): boolean {
  const range = parseOpeningHours(hoursText)
  if (!range) return false
  const p = ((Math.round(plannedMinutes) % 1440) + 1440) % 1440
  const isOpen = range.end > 1440 ? p >= range.start || p <= range.end - 1440 : p >= range.start && p <= range.end
  return !isOpen
}

// ---- Travel time estimate ----

// Walking speed for a relaxed shopping-trip pace (not a brisk commute) — used under
// ~1 km, since at that distance walking is almost always faster than dealing with a train
// (station access + wait + ride + station egress all add up for a short hop).
const WALK_KMH = 5
const WALK_THRESHOLD_KM = 1

// Central Tokyo train estimate for 1 km or further: a fixed overhead for station
// access/egress and waiting for a train (off-peak subway/commuter trains run roughly every
// 3-10 min), plus a per-km figure for a train's effective door-to-door speed once stops
// and any line change are factored in (roughly 25-35 km/h in practice -> ~2 min/km).
export const TRAIN_OVERHEAD_MIN = 10
export const TRAIN_MIN_PER_KM = 2

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

export function estimateTravelMinutes(a: RoutePoint, b: RoutePoint, preferMinutes?: number | null): number {
  if (preferMinutes != null) return preferMinutes
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0
  const km = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng })
  if (km < WALK_THRESHOLD_KM) return Math.max(1, Math.round((km / WALK_KMH) * 60))
  return Math.round(TRAIN_OVERHEAD_MIN + km * TRAIN_MIN_PER_KM)
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
function computeSchedule(order: OptimizerStop[], startTime: number, start: RoutePoint): RouteSchedule {
  let clock = startTime
  let prevPoint: RoutePoint = start
  let travelMin = 0
  let waitMin = 0
  let closedCount = 0
  const times: number[] = []

  order.forEach((stop, i) => {
    if (stop.fixedTime != null) {
      clock = stop.fixedTime
    } else {
      const preferMinutes = i === 0 ? extractNoteTravelMinutes(stop.note) : null
      const travel = estimateTravelMinutes(prevPoint, stop, preferMinutes)
      clock += travel
      travelMin += travel
    }
    const range = parseOpeningHours(stop.openingHours)
    if (range && clock < range.start) waitMin += range.start - clock
    if (looksClosed(stop.openingHours, clock)) closedCount++
    times.push(clock)
    clock += stop.durationMin
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
function bestMovableOrder(stops: OptimizerStop[], movableIdx: number[], fixedSlotsOrder: number[], startTime: number, start: RoutePoint): number[] {
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
    return computeSchedule(full.map((i) => stops[i]), startTime, start).score
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
export function optimizeRoute(stops: OptimizerStop[], startTime: number, start: RoutePoint | null): OptimizeResult {
  const currentOrder = stops.map((_, i) => i)
  const hasStart = !!start && start.lat != null && start.lng != null
  const usedFirstStopAsStart = !hasStart && stops.length > 0
  const effectiveStart: RoutePoint = hasStart ? (start as RoutePoint) : stops.length > 0 ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: null, lng: null }

  const current = computeSchedule(stops, startTime, effectiveStart)

  if (stops.length === 0) {
    return { order: [], currentOrder, suggested: current, current, usedFirstStopAsStart, improved: false }
  }

  const fixedIdx = currentOrder.filter((i) => stops[i].fixedTime != null)
  const movableIdx = currentOrder.filter((i) => stops[i].fixedTime == null)
  const bestMovable = bestMovableOrder(stops, movableIdx, fixedIdx, startTime, effectiveStart)

  const order: number[] = new Array(stops.length)
  fixedIdx.forEach((i) => { order[i] = i })
  let m = 0
  for (let pos = 0; pos < stops.length; pos++) {
    if (order[pos] === undefined) order[pos] = bestMovable[m++]
  }

  const suggested = computeSchedule(order.map((i) => stops[i]), startTime, effectiveStart)

  return {
    order,
    currentOrder,
    suggested,
    current,
    usedFirstStopAsStart,
    improved: suggested.score < current.score,
  }
}
