// One day's timetable for /itinerary (and /api/itinerary-review): when you arrive at each
// stop, when you have to leave it, and which stops don't fit before a fixed-time stop. Pure
// and deterministic, so the page and the review can't disagree and tests can check it.
//
// Times are minutes after midnight on the day, in Japan time (see lib/trip-dates.ts).
//
// The rules:
// - A stop with a fixed time is an anchor: you arrive at fixedTime − arriveEarlyMin (e.g. a
//   19:00 session you must be at 30 min early: arrive 18:30), and the visit runs from
//   fixedTime for its duration.
// - Every other stop is scheduled forward: arrive when the previous stop ends plus the travel
//   time, stay for its duration.
// - Travel into a stop, in order: a time entered for that leg (manualTravelMin), the shop
//   note's time (only for the first leg, from the base — the notes describe the trip from
//   Akihabara), otherwise the estimate (route-optimizer.ts estimateLeg).
// - Leaving for an anchor: leaveBy = anchor arrival − travel − LEAVE_BUFFER_MIN. Leaving for
//   any other stop: leaveBy = this stop's end (that stop is scheduled from it, so no buffer).
// - A non-fixed stop that can't be done before the next anchor (counting its own stay, the
//   travel and the buffer, and the stops between it and the anchor) gets `doesntFit`, with how
//   many minutes short — it keeps its forward time, which is past what the anchor allows.
// - A fixed stop followed by another anchor gets `stayUntil`: the latest it can end and still
//   make the next anchor (through any stops in between); `leaveEarlierMin` when its planned
//   end is later than that.

import { estimateLeg, type RoutePoint } from './route-optimizer'

// Slack before a fixed-time stop: missing it costs a reservation, a session or a flight.
export const LEAVE_BUFFER_MIN = 10

export type ScheduleStopInput = {
  name: string
  lat: number | null
  lng: number | null
  durationMin: number
  fixedTime: number | null // minutes after midnight, or null
  arriveEarlyMin: number | null // fixed stops only: be there this many minutes before fixedTime
  manualTravelMin: number | null // travel time entered for the leg INTO this stop
  noteTravelMin: number | null // from the shop's note; only used for the leg from the base
}

export type TravelLeg = { minutes: number; source: 'manual' | 'note' | 'estimate'; mode: 'walk' | 'train' | null }

export type ScheduledStop = {
  arrival: number // when you get there (an anchor: fixedTime − arriveEarlyMin)
  start: number // when the visit starts (an anchor: fixedTime)
  end: number
  fixed: boolean
  travelIn: TravelLeg // from the previous stop, or from the base for the first
  leaveBy: number | null // for the leg to the next stop; null for the day's last stop
  nextIsAnchor: boolean
  leaveEarlierMin: number | null // the stop ends this much later than leaveBy (only before an anchor)
  stayUntil: number | null // fixed stops followed by an anchor
  doesntFit: { anchorIndex: number; anchorTime: number; shortMin: number } | null
}

export type DaySchedule = { stops: ScheduledStop[]; returnLeg: TravelLeg | null; end: number }

export function anchorArrival(stop: ScheduleStopInput): number | null {
  if (stop.fixedTime == null) return null
  return stop.fixedTime - Math.max(0, stop.arriveEarlyMin || 0)
}

function legBetween(from: RoutePoint, to: ScheduleStopInput, fromBase: boolean): TravelLeg {
  if (to.manualTravelMin != null && to.manualTravelMin >= 0) return { minutes: to.manualTravelMin, source: 'manual', mode: null }
  if (fromBase && to.noteTravelMin != null && to.noteTravelMin >= 0) return { minutes: to.noteTravelMin, source: 'note', mode: null }
  const est = estimateLeg(from, to)
  return { minutes: est ? est.minutes : 0, source: 'estimate', mode: est ? est.mode : null }
}

export function scheduleDay(stops: ScheduleStopInput[], startTime: number, base: RoutePoint): DaySchedule {
  const legs = stops.map((s, i) => legBetween(i === 0 ? base : stops[i - 1], s, i === 0))

  // Forward: arrival, start and end of every stop.
  const out: ScheduledStop[] = []
  let clock = startTime
  stops.forEach((s, i) => {
    const anchor = anchorArrival(s)
    const arrival = anchor != null ? anchor : clock + legs[i].minutes
    const start = s.fixedTime != null ? s.fixedTime : arrival
    const end = start + s.durationMin
    out.push({
      arrival, start, end, fixed: s.fixedTime != null, travelIn: legs[i],
      leaveBy: null, nextIsAnchor: false, leaveEarlierMin: null, stayUntil: null, doesntFit: null,
    })
    clock = end
  })

  // Backward from each anchor: the latest each earlier stop can end and still make it.
  // latestEnd[i] is only set for stops that have an anchor somewhere after them.
  const latestEnd: (number | null)[] = stops.map(() => null)
  const nextAnchor: (number | null)[] = stops.map(() => null)
  let anchorIdx: number | null = null
  let latestArrivalNext: number | null = null
  for (let i = stops.length - 1; i >= 0; i--) {
    if (i < stops.length - 1 && anchorIdx != null && latestArrivalNext != null) {
      const intoNext = legs[i + 1].minutes + (stops[i + 1].fixedTime != null ? LEAVE_BUFFER_MIN : 0)
      latestEnd[i] = latestArrivalNext - intoNext
      nextAnchor[i] = anchorIdx
    }
    if (stops[i].fixedTime != null) {
      anchorIdx = i
      latestArrivalNext = anchorArrival(stops[i])
    } else if (latestEnd[i] != null) {
      latestArrivalNext = latestEnd[i]! - stops[i].durationMin
    }
  }

  out.forEach((o, i) => {
    if (i === stops.length - 1) return
    const next = stops[i + 1]
    o.nextIsAnchor = next.fixedTime != null
    o.leaveBy = o.nextIsAnchor ? anchorArrival(next)! - legs[i + 1].minutes - LEAVE_BUFFER_MIN : o.end
    if (o.nextIsAnchor && o.end > o.leaveBy) o.leaveEarlierMin = o.end - o.leaveBy
    const a = nextAnchor[i]
    if (a == null || latestEnd[i] == null) return
    if (o.fixed) {
      o.stayUntil = latestEnd[i]
      if (o.end > latestEnd[i]!) o.leaveEarlierMin = o.end - latestEnd[i]!
    } else if (o.end > latestEnd[i]!) {
      o.doesntFit = { anchorIndex: a, anchorTime: stops[a].fixedTime!, shortMin: o.end - latestEnd[i]! }
    }
  })

  const last = stops[stops.length - 1]
  const returnLeg = last ? (() => {
    const est = estimateLeg(last, base)
    return { minutes: est ? est.minutes : 0, source: 'estimate' as const, mode: est ? est.mode : null }
  })() : null
  const end = out.length ? out[out.length - 1].end + (returnLeg ? returnLeg.minutes : 0) : startTime
  return { stops: out, returnLeg, end }
}

// Google Maps public transit directions between two stops: coordinates when both ends have
// them, otherwise the names.
export function transitRouteUrl(from: { name: string; lat: number | null; lng: number | null }, to: { name: string; lat: number | null; lng: number | null }): string {
  const place = (p: { name: string; lat: number | null; lng: number | null }) => (p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : p.name)
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(place(from))}&destination=${encodeURIComponent(place(to))}&travelmode=transit`
}
