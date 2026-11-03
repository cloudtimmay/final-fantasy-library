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
// - The non-fixed stops before an anchor (back to the previous anchor or the day's start) are a
//   segment. If together they run past the anchor (the last one's end + travel + buffer is
//   later than the anchor's arrival), the segment gets ONE overrun figure (`segments`), with the
//   longest non-MUST visits as suggestions. Individually, only the stops that really can't make
//   it are flagged (`doesntFit`): the first whose own end + the trip straight to the anchor +
//   the buffer is later than the anchor's arrival, and every stop after it in the segment.
//   Earlier stops are fine on their own — it's the stops after them that don't fit.
// - A fixed stop followed by another anchor gets `stayUntil`: the latest it can end and still
//   make the next anchor (through any stops in between); `leaveEarlierMin` when its planned
//   end is later than that.
// - Actual times ("I'm here now" / "Leaving now" on the timeline): a non-fixed stop with
//   `actualStart` starts then, and with `actualEnd` ends then; everything after it runs on from
//   that. A fixed stop never moves — only its actual end carries forward. So the warnings update
//   (doesn't fit, leave earlier, segment overrun) instead; a stop already left (`visited`) gets
//   none itself.

import { estimateLeg, type RoutePoint } from './route-optimizer'
import { tokyoNow } from './trip-dates'

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
  must?: boolean // tagged MUST: never suggested as the visit to shorten
  actualStart?: number | null // when you really got there (minutes after midnight)
  actualEnd?: number | null // when you really left
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
  actual: boolean // its times come from actualStart/actualEnd
  visited: boolean // already left (actualEnd set)
}

// The non-fixed stops before an anchor need `overrunMin` more than there is. `suggestions`: up to
// three of the segment's longest visits not marked MUST, longest first.
export type SegmentOverrun = {
  anchorIndex: number
  anchorTime: number
  overrunMin: number
  firstLateIndex: number
  suggestions: { index: number; name: string; durationMin: number }[]
}

export type DaySchedule = { stops: ScheduledStop[]; segments: SegmentOverrun[]; returnLeg: TravelLeg | null; end: number }

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
    const actualStart = s.fixedTime == null && s.actualStart != null ? s.actualStart : null
    const arrival = anchor != null ? anchor : actualStart != null ? actualStart : clock + legs[i].minutes
    const start = s.fixedTime != null ? s.fixedTime : arrival
    const end = s.actualEnd != null ? Math.max(s.actualEnd, start) : start + s.durationMin
    out.push({
      arrival, start, end, fixed: s.fixedTime != null, travelIn: legs[i],
      leaveBy: null, nextIsAnchor: false, leaveEarlierMin: null, stayUntil: null, doesntFit: null,
      actual: actualStart != null || s.actualEnd != null, visited: s.actualEnd != null,
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
    if (o.nextIsAnchor && o.end > o.leaveBy && !o.visited) o.leaveEarlierMin = o.end - o.leaveBy
    if (nextAnchor[i] == null || latestEnd[i] == null) return
    if (o.fixed) {
      o.stayUntil = latestEnd[i]
      if (o.end > latestEnd[i]! && !o.visited) o.leaveEarlierMin = o.end - latestEnd[i]!
    }
  })

  // Per segment: the non-fixed stops between the previous anchor (or the start) and anchor a.
  const segments: SegmentOverrun[] = []
  let segStart = 0
  stops.forEach((s, a) => {
    if (s.fixedTime == null) return
    const members: number[] = []
    for (let k = segStart; k < a; k++) members.push(k)
    segStart = a + 1
    if (!members.length) return // nothing between two anchors: "leave earlier" on the first covers it
    const arrive = anchorArrival(s)!
    const overrunMin = out[a - 1].end + legs[a].minutes + LEAVE_BUFFER_MIN - arrive
    if (overrunMin <= 0) return
    // The trip straight from stop k to the anchor (the real leg for the last one).
    const toAnchor = (k: number) => {
      if (k === a - 1) return legs[a].minutes
      const est = estimateLeg(stops[k], s)
      return est ? est.minutes : legs[a].minutes
    }
    // Stops already left are past fixing: the first late one is among those still ahead.
    const ahead = members.filter((k) => !out[k].visited)
    const firstLateIndex = ahead.find((k) => out[k].end + toAnchor(k) + LEAVE_BUFFER_MIN > arrive) ?? members[members.length - 1]
    ahead.filter((k) => k >= firstLateIndex).forEach((k) => {
      out[k].doesntFit = { anchorIndex: a, anchorTime: s.fixedTime!, shortMin: out[k].end + toAnchor(k) + LEAVE_BUFFER_MIN - arrive }
    })
    const suggestions = members
      .filter((k) => !stops[k].must)
      .sort((x, y) => stops[y].durationMin - stops[x].durationMin || x - y)
      .slice(0, 3)
      .map((k) => ({ index: k, name: stops[k].name, durationMin: stops[k].durationMin }))
    segments.push({ anchorIndex: a, anchorTime: s.fixedTime!, overrunMin, firstLateIndex, suggestions })
  })

  const last = stops[stops.length - 1]
  const returnLeg = last ? (() => {
    const est = estimateLeg(last, base)
    return { minutes: est ? est.minutes : 0, source: 'estimate' as const, mode: est ? est.mode : null }
  })() : null
  const end = out.length ? out[out.length - 1].end + (returnLeg ? returnLeg.minutes : 0) : startTime
  return { stops: out, segments, returnLeg, end }
}

// Google Maps public transit directions between two stops: coordinates when both ends have
// them, otherwise the names.
export function transitRouteUrl(from: { name: string; lat: number | null; lng: number | null }, to: { name: string; lat: number | null; lng: number | null }): string {
  const place = (p: { name: string; lat: number | null; lng: number | null }) => (p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : p.name)
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(place(from))}&destination=${encodeURIComponent(place(to))}&travelmode=transit`
}

// --- "⏰ Reminder": a calendar event at a stop's leave-by time ---------------------------------
// An .ics file (RFC 5545) the phone's calendar opens, starting at the leave-by time in
// Asia/Tokyo (with its own VTIMEZONE, so the alarm fires at the right moment in Japan whatever
// time zone the phone is on), an alarm at the event time, and the route link in the description.
// A phone still on Norwegian time shows the event at its Norwegian time, so the title carries the
// Japan time itself — "Leave <stop> 17:35 JST → <next stop>" — and the description says so.
export const JST_NOTE = "Times are Japan time (JST). Your calendar shows this in your phone's current time zone."

export function leaveReminderIcs(o: { date: string; leaveBy: number; from: string; to: string; routeUrl: string; now?: Date }): string {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.date)
  if (!p) throw new Error(`Not a calendar date: ${o.date}`)
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = `${p[1]}${p[2]}${p[3]}T${pad(Math.floor(o.leaveBy / 60))}${pad(o.leaveBy % 60)}00`
  const stamp = (o.now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const jst = `${pad(Math.floor(o.leaveBy / 60))}:${pad(o.leaveBy % 60)}`
  const title = `Leave ${o.from} ${jst} JST → ${o.to}`
  const uid = `leave-${local}-${slug(o.from)}-${slug(o.to)}@final-fantasy-library`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Final Fantasy Library//Itinerary//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Tokyo:${local}`,
    'DURATION:PT15M',
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(`${JST_NOTE}\nRoute: ${o.routeUrl}`)}`,
    `URL:${o.routeUrl}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'stop'
}

// Text values escape backslash, semicolon, comma and newlines.
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Lines longer than 75 octets are folded: CRLF + a space, never splitting a character.
function foldLine(line: string): string {
  const enc = new TextEncoder()
  const parts: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; bytes = 0 }
    cur += ch
    bytes += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

// --- "Next: leave <stop> by HH:MM (in N min)" --------------------------------------------------
// The next leave-by time today, by the clock in Tokyo (whatever timezone the phone is set to):
// the earliest leg on today's date whose leave-by hasn't passed. null when there's none —
// before or after the trip, or when today's last leave-by has gone.
export type LeaveEntry = { date: string; from: string; to: string; leaveBy: number }
export function nextLeave(entries: LeaveEntry[], now: Date = new Date()): (LeaveEntry & { inMin: number }) | null {
  const t = tokyoNow(now)
  const next = entries
    .filter((e) => e.date === t.date && e.leaveBy >= t.minutes)
    .sort((a, b) => a.leaveBy - b.leaveBy)[0]
  return next ? { ...next, inMin: next.leaveBy - t.minutes } : null
}
