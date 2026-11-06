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
// - "Leave at" (`leaveAt`): the visit ends then, whatever its duration — it lasts from its arrival
//   (or fixed time) to leaveAt, and the next stop runs on from leaveAt. Arriving at or after it:
//   `arrivesAfterLeave`, and the visit takes no time. A leave time well before the start (01:00
//   for an evening visit) is the next morning.
// - A train on the leg into a stop (`train`, chosen on the timeline): the leg runs from the
//   stop before's leave-by — the departure minus TRAIN_PLATFORM_MIN (and the walk to the station
//   when known) — to the final arrival plus TRAIN_EXIT_WALK_MIN, when the stop starts. The train
//   is an anchor for the stops before it, like a fixed time: "leave earlier", "doesn't fit" and
//   the segment overrun all count back from its leave-by. On a fixed-time stop, a train arriving
//   too late for it is `trainLateMin`.

import { estimateLeg, type RoutePoint } from './route-optimizer'
import { tokyoNow, addDays } from './trip-dates'

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
  leaveAt?: number | null // "Leave at": when the visit ends (minutes after midnight)
  train?: TrainTimes | null // a train on the leg INTO this stop
}

// A train's times on a leg (lib/train-plan.ts trainTimes): minutes after midnight, the arrival
// after the departure (past midnight when it runs over).
export type TrainTimes = { departure: number; arrival: number; walkToStationMin?: number | null; walkFromStationMin?: number | null }
// Time to get to the platform before the train leaves, and from the arrival platform to the stop
// when the trip doesn't give its own walk from the last station.
export const TRAIN_PLATFORM_MIN = 10
export const TRAIN_EXIT_WALK_MIN = 5
export const TRAIN_EARLY_HINT_MIN = 30
// "Arrives 08:22, 68 min before 09:30. A later train may be possible."
export function trainEarlyHint(e: { arrival: number; fixedTime: number }): string {
  const c = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return `Arrives ${c(e.arrival)}, ${e.fixedTime - e.arrival} min before ${c(e.fixedTime)}. A later train may be possible.`
}
// The latest the stop before a train leg can end.
export function trainLeaveBy(t: TrainTimes): number {
  return t.departure - TRAIN_PLATFORM_MIN - Math.max(0, t.walkToStationMin || 0)
}

export type TravelLeg = { minutes: number; source: 'manual' | 'note' | 'estimate' | 'train'; mode: 'walk' | 'train' | null }

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
  // Any stop followed by an anchor (fixed time, arrive-early, train): the latest it can end and
  // still make it — for a fixed stop the same as stayUntil. null when nothing after it is fixed.
  latestLeave: number | null
  doesntFit: { anchorIndex: number; anchorTime: number; shortMin: number } | null
  actual: boolean // its times come from actualStart/actualEnd
  visited: boolean // already left (actualEnd set)
  arrivesAfterLeave: number | null // its leaveAt, when you get there at or after it
  trainLateMin: number | null // a fixed-time stop: its train arrives this much too late for it
  // A fixed-time stop its train reaches more than TRAIN_EARLY_HINT_MIN early: when you arrive, and
  // the fixed time (a later train may do).
  trainEarly: { arrival: number; fixedTime: number } | null
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

// `opts.returnTrain`: a train planned for the trip back to the base — the last stop must be left by
// its leave-by (an anchor like a train into a stop), and the day ends at its arrival + the walk.
export function scheduleDay(stops: ScheduleStopInput[], startTime: number, base: RoutePoint, opts: { returnTrain?: TrainTimes | null } = {}): DaySchedule {
  const legs = stops.map((s, i) => legBetween(i === 0 ? base : stops[i - 1], s, i === 0))

  // Forward: arrival, start and end of every stop.
  const out: ScheduledStop[] = []
  // Each leg's train, on the day's clock (a train after midnight is the next morning).
  const trains: (TrainTimes | null)[] = stops.map(() => null)
  let clock = startTime
  stops.forEach((s, i) => {
    let trainArrival: number | null = null
    if (s.train) {
      const shift = s.train.departure + 720 < clock ? 1440 : 0
      const t = { ...s.train, departure: s.train.departure + shift, arrival: s.train.arrival + shift }
      trains[i] = t
      trainArrival = t.arrival + (t.walkFromStationMin ?? TRAIN_EXIT_WALK_MIN)
      // The leg: from the stop before's leave-by to the stop.
      legs[i] = { minutes: trainArrival - trainLeaveBy(t), source: 'train', mode: 'train' }
    }
    const anchor = anchorArrival(s)
    const actualStart = s.fixedTime == null && s.actualStart != null ? s.actualStart : null
    const arrival = anchor != null ? anchor : actualStart != null ? actualStart : trainArrival != null ? trainArrival : clock + legs[i].minutes
    const start = s.fixedTime != null ? s.fixedTime : arrival
    const leaveAt = s.leaveAt != null ? (s.leaveAt + 720 < start ? s.leaveAt + 1440 : s.leaveAt) : null
    const late = leaveAt != null && s.actualEnd == null && arrival >= leaveAt
    const end = s.actualEnd != null ? Math.max(s.actualEnd, start)
      : leaveAt != null ? (late ? start : Math.max(leaveAt, start))
      : start + s.durationMin
    out.push({
      arrival, start, end, fixed: s.fixedTime != null, travelIn: legs[i],
      leaveBy: null, nextIsAnchor: false, leaveEarlierMin: null, stayUntil: null, latestLeave: null, doesntFit: null,
      actual: actualStart != null || s.actualEnd != null, visited: s.actualEnd != null,
      arrivesAfterLeave: late ? leaveAt : null,
      trainLateMin: anchor != null && trainArrival != null && trainArrival > anchor ? trainArrival - anchor : null,
      trainEarly: s.fixedTime != null && trainArrival != null && s.fixedTime - trainArrival > TRAIN_EARLY_HINT_MIN ? { arrival: trainArrival, fixedTime: s.fixedTime } : null,
    })
    clock = end
  })

  // The train back to the base, on the day's clock (after midnight: the next morning).
  const lastIdx = stops.length - 1
  const rt = opts.returnTrain && stops.length ? (() => {
    const shift = opts.returnTrain!.departure + 720 < out[lastIdx].end ? 1440 : 0
    return { ...opts.returnTrain!, departure: opts.returnTrain!.departure + shift, arrival: opts.returnTrain!.arrival + shift }
  })() : null

  // Backward from each anchor: the latest each earlier stop can end and still make it.
  // latestEnd[i] is only set for stops that have an anchor somewhere after them.
  const latestEnd: (number | null)[] = stops.map(() => null)
  const nextAnchor: (number | null)[] = stops.map(() => null)
  let anchorIdx: number | null = null
  let latestArrivalNext: number | null = null
  if (rt) {
    // The train back: the last stop must be left by its leave-by (index stops.length: no stop).
    latestEnd[lastIdx] = trainLeaveBy(rt)
    nextAnchor[lastIdx] = stops.length
    anchorIdx = stops.length
  }
  for (let i = stops.length - 1; i >= 0; i--) {
    if (i < stops.length - 1 && anchorIdx != null && latestArrivalNext != null) {
      const intoNext = legs[i + 1].minutes + (stops[i + 1].fixedTime != null ? LEAVE_BUFFER_MIN : 0)
      latestEnd[i] = latestArrivalNext - intoNext
      nextAnchor[i] = anchorIdx
    }
    if (trains[i]) {
      // Catch the train: the stop before must end by its leave-by (whatever the stop's own time).
      anchorIdx = i
      latestArrivalNext = trainLeaveBy(trains[i]!) + legs[i].minutes + (stops[i].fixedTime != null ? LEAVE_BUFFER_MIN : 0)
    } else if (stops[i].fixedTime != null) {
      anchorIdx = i
      latestArrivalNext = anchorArrival(stops[i])
    } else if (latestEnd[i] != null) {
      latestArrivalNext = latestEnd[i]! - (out[i].end - out[i].start) // its length (a leave time sets it)
    }
  }

  out.forEach((o, i) => {
    if (i === lastIdx) {
      if (!rt) return
      o.nextIsAnchor = true
      o.leaveBy = trainLeaveBy(rt)
      if (o.end > o.leaveBy && !o.visited) o.leaveEarlierMin = o.end - o.leaveBy
      if (!o.visited) o.latestLeave = o.leaveBy
      if (o.fixed) o.stayUntil = o.leaveBy
      return
    }
    const next = stops[i + 1]
    o.nextIsAnchor = next.fixedTime != null || !!trains[i + 1]
    o.leaveBy = trains[i + 1] ? trainLeaveBy(trains[i + 1]!) : o.nextIsAnchor ? anchorArrival(next)! - legs[i + 1].minutes - LEAVE_BUFFER_MIN : o.end
    if (o.nextIsAnchor && o.end > o.leaveBy && !o.visited) o.leaveEarlierMin = o.end - o.leaveBy
    if (nextAnchor[i] == null || latestEnd[i] == null) return
    if (!o.visited) o.latestLeave = latestEnd[i]
    if (o.fixed) {
      o.stayUntil = latestEnd[i]
      if (o.end > latestEnd[i]! && !o.visited) o.leaveEarlierMin = o.end - latestEnd[i]!
    }
  })

  // Per segment: the non-fixed stops between the previous anchor (or the start) and anchor a.
  const segments: SegmentOverrun[] = []
  let segStart = 0
  stops.forEach((s, a) => {
    if (s.fixedTime == null && !trains[a]) return
    const members: number[] = []
    for (let k = segStart; k < a; k++) members.push(k)
    segStart = a + 1
    if (!members.length) return // nothing between two anchors: "leave earlier" on the first covers it
    if (trains[a]) {
      // A train: the stops before it must be done by its leave-by.
      const deadline = trainLeaveBy(trains[a]!)
      const overrunMin = out[a - 1].end - deadline
      if (overrunMin <= 0) return
      const ahead = members.filter((k) => !out[k].visited)
      const firstLateIndex = ahead.find((k) => out[k].end > deadline) ?? members[members.length - 1]
      ahead.filter((k) => k >= firstLateIndex).forEach((k) => {
        out[k].doesntFit = { anchorIndex: a, anchorTime: trains[a]!.departure, shortMin: out[k].end - deadline }
      })
      const suggestions = members
        .filter((k) => !stops[k].must)
        .sort((x, y) => (out[y].end - out[y].start) - (out[x].end - out[x].start) || x - y)
        .slice(0, 3)
        .map((k) => ({ index: k, name: stops[k].name, durationMin: out[k].end - out[k].start }))
      segments.push({ anchorIndex: a, anchorTime: trains[a]!.departure, overrunMin, firstLateIndex, suggestions })
      return
    }
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
      .sort((x, y) => (out[y].end - out[y].start) - (out[x].end - out[x].start) || x - y)
      .slice(0, 3)
      .map((k) => ({ index: k, name: stops[k].name, durationMin: out[k].end - out[k].start }))
    segments.push({ anchorIndex: a, anchorTime: s.fixedTime!, overrunMin, firstLateIndex, suggestions })
  })

  const last = stops[stops.length - 1]
  // Back at the base: by the planned train (its arrival + the walk), else the estimate.
  const backByTrain = rt ? rt.arrival + (rt.walkFromStationMin ?? TRAIN_EXIT_WALK_MIN) : null
  const returnLeg: TravelLeg | null = !last ? null
    : backByTrain != null ? { minutes: Math.max(0, backByTrain - out[lastIdx].end), source: 'train', mode: 'train' }
    : (() => {
      const est = estimateLeg(last, base)
      return { minutes: est ? est.minutes : 0, source: 'estimate' as const, mode: est ? est.mode : null }
    })()
  const end = !out.length ? startTime : backByTrain != null ? Math.max(backByTrain, out[lastIdx].end) : out[lastIdx].end + (returnLeg ? returnLeg.minutes : 0)
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

// One reminder. `key` identifies the stop you leave (its shop's id, else its name): the UID is
// "leave-<day>-<key>", the same for that stop on that day whatever its time or the next stop —
// so a calendar that supports it updates the event instead of adding another.
// `trainDeparture`: the leg is a chosen train ("Leave … for the 17:42 train").
export type ReminderInput = { date: string; leaveBy: number; from: string; to: string; routeUrl: string; key?: string; trainDeparture?: string; now?: Date }
const pad2 = (n: number) => String(n).padStart(2, '0')
// "Leave Square Enix Pop Up Cafe 17:35 JST → Tokyo Temple" — the event's title, and the list's;
// on a train leg "Leave … 17:30 JST for the 17:42 train → …".
export function reminderTitle(from: string, leaveBy: number, to: string, trainDeparture?: string): string {
  return `Leave ${from} ${pad2(Math.floor(leaveBy / 60) % 24)}:${pad2(leaveBy % 60)} JST${trainDeparture ? ` for the ${trainDeparture} train` : ''} → ${to}`
}
function reminderEvent(o: ReminderInput): string[] {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.date)
  if (!p) throw new Error(`Not a calendar date: ${o.date}`)
  const local = `${p[1]}${p[2]}${p[3]}T${pad2(Math.floor(o.leaveBy / 60))}${pad2(o.leaveBy % 60)}00`
  const stamp = (o.now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const title = reminderTitle(o.from, o.leaveBy, o.to, o.trainDeparture)
  const uid = `leave-${p[1]}${p[2]}${p[3]}-${slug(o.key || o.from)}@final-fantasy-library`
  return [
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
  ]
}
export function leaveReminderIcs(o: ReminderInput): string {
  return leaveRemindersIcs([o])
}
// Several reminders in one file ("⏰ Reminders for this day"): one VEVENT each.
export function leaveRemindersIcs(list: ReminderInput[]): string {
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
    ...list.flatMap(reminderEvent),
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
// `lastTrain`: the leg is a train leaving after the last trains (lastTrainLegs).
export type LeaveEntry = { date: string; from: string; to: string; leaveBy: number; lastTrain?: boolean }
export function nextLeave(entries: LeaveEntry[], now: Date = new Date()): (LeaveEntry & { inMin: number }) | null {
  const t = tokyoNow(now)
  // A leave-by after midnight (past 24:00 on its day) is on the next calendar day.
  const onItsDate = entries.map((e) => (e.leaveBy >= 1440 ? { ...e, date: addDays(e.date, Math.floor(e.leaveBy / 1440)), leaveBy: e.leaveBy % 1440 } : e))
  const next = onItsDate
    .filter((e) => e.date === t.date && e.leaveBy >= t.minutes)
    .sort((a, b) => a.leaveBy - b.leaveBy)[0]
  return next ? { ...next, inMin: next.leaveBy - t.minutes } : null
}

// --- The day warning (the timeline, the list, Check day, the "Next" banner) -----------------
// Only for what really breaks a day: the trip back to the base by train leaving after the last
// trains, or stops that are closed when you get there. A late evening by itself is fine (a shop
// open 24 hours at 23:07 with a walk back is no problem).
export const LAST_TRAIN_MIN = 24 * 60 // a train leg leaving at or after this may not run
export const LAST_TRAIN_MESSAGE = 'Trains may not run (last trains around midnight)'

const clock = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

// `closed`: the stops closed at their planned time (opening hours are checked by the caller,
// itinerary-plan.ts closedStops — this module doesn't read hours). `involved`: the stops "Move
// to…" offers — the closed ones, and for a late train back the stops that end after the last
// trains (else the last stop, which sets when you leave).
export type DayWarning = { returnTrain: number | null; closed: number[]; involved: number[] }
export function dayWarning(sched: DaySchedule, closed: number[]): DayWarning | null {
  const back = lastTrainLegs(sched).find((l) => l.index === sched.stops.length)
  if (!back && !closed.length) return null
  let late: number[] = []
  if (back) {
    late = sched.stops.map((x, i) => (x.end > LAST_TRAIN_MIN ? i : -1)).filter((i) => i >= 0)
    if (!late.length) late = [sched.stops.length - 1]
  }
  return { returnTrain: back ? back.departs : null, closed, involved: [...new Set([...closed, ...late])].sort((a, b) => a - b) }
}
// "The trip back to the base leaves at 00:20. Trains may not run." / "2 stops are closed at the
// planned time."
export function dayWarningMessages(w: DayWarning): string[] {
  const out: string[] = []
  if (w.returnTrain != null) out.push(`The trip back to the base leaves at ${clock(w.returnTrain)}. Trains may not run.`)
  const n = w.closed.length
  if (n) out.push(`${n} stop${n === 1 ? ' is' : 's are'} closed at the planned time.`)
  return out
}
// A visit that starts after midnight (the day's own date, minutes past 24:00).
export const afterMidnight = (x: ScheduledStop) => x.start >= 1440

// Train legs leaving at or after LAST_TRAIN_MIN: the leg into stop `index`, or (index = the
// number of stops) the trip back to the base. A leg with a typed-in time has no known mode.
export function lastTrainLegs(sched: DaySchedule): { index: number; departs: number }[] {
  const out: { index: number; departs: number }[] = []
  sched.stops.forEach((x, i) => {
    const departs = x.arrival - x.travelIn.minutes
    if (x.travelIn.mode === 'train' && departs >= LAST_TRAIN_MIN) out.push({ index: i, departs })
  })
  const last = sched.stops[sched.stops.length - 1]
  if (last && sched.returnLeg?.mode === 'train' && last.end >= LAST_TRAIN_MIN) out.push({ index: sched.stops.length, departs: last.end })
  return out
}
