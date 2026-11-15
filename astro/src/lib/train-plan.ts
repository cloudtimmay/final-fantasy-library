// A chosen train trip on an itinerary leg — "🚆 Plan train" on the timeline. Stored on the stop
// AFTER the leg (`train` on the saved stop, like the manual travel time), entered by hand or read
// from a screenshot of a route (/api/train-from-screenshot). Like Google Maps shows a route: an
// ordered list of train legs (Yamanote Line → Tokaido Shinkansen Hikari 701 → Tokaido Line), plus
// the walk to the first station. The schedule (itinerary-schedule.ts) takes the first departure as
// the leg's anchor and starts the next stop after the last arrival.
// Pure: reading (old saves included), validation, the times in minutes, and how it's shown.

// How a leg is ridden — a train unless said otherwise (a bus, a tram … on the same route).
export const TRANSIT_MODES = ['train', 'subway', 'bus', 'tram', 'ferry', 'monorail'] as const
export type TransitMode = (typeof TRANSIT_MODES)[number]
export const MODE_ICON: Record<TransitMode, string> = { train: '🚆', subway: '🚇', bus: '🚌', tram: '🚋', ferry: '⛴️', monorail: '🚝' }
export const MODE_LABEL: Record<TransitMode, string> = { train: 'Train', subway: 'Subway', bus: 'Bus', tram: 'Tram', ferry: 'Ferry', monorail: 'Monorail' }
const isMode = (v: unknown): v is TransitMode => typeof v === 'string' && (TRANSIT_MODES as readonly string[]).includes(v)

export type TrainLeg = {
  mode?: TransitMode // only when not a train ("bus" …); a train when left out
  direction?: string // toward where, e.g. "Ōfuna" — when the route says
  line: string // "Tokaido Shinkansen"; a through service both names, "Keihin-Tōhoku Line / Negishi Line"; a bus its route, "Route 106"
  train: string // name or number, e.g. "Hikari 701"; "local"
  fromStation: string
  departure: string // "HH:MM"
  platform: string
  toStation: string
  arrival: string // "HH:MM"
}
export type TrainPlan = {
  walkToStationMin?: number // from the stop before to the first station, when known
  walkFromStationMin?: number // from the last station to the stop (DEFAULT_WALK_FROM_STATION_MIN when not known)
  fareYen?: number // the fare for the whole trip, per person, as Google Maps shows it (¥6,670)
  travelers?: number // how many take this train, when not the trip's number (Trip Settings → Travelers)
  legs: TrainLeg[]
}

// Travelers when Trip Settings has no number: the family of five.
export const DEFAULT_TRAVELERS = 5
const MAX_TRAVELERS = 20

// From the last station to the stop, when the route doesn't say.
export const DEFAULT_WALK_FROM_STATION_MIN = 5
const MAX_FARE_YEN = 200000

export const MAX_LEGS = 6
const MAX_TEXT = 60
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '')
const minutesOf = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5)
// "9:05" -> "09:05"; anything else stays as it is (and fails the check).
const clockText = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s
}

// The legs of a saved train in either shape: { legs } (now), or the first version's one "main"
// train with "transfers" (its line and first departure, the final arrival, and per transfer the
// station, the next line, the arrival there and the next departure) — read as legs.
function legsOf(r: any): any[] {
  if (Array.isArray(r?.legs)) return r.legs
  if (!r || (r.departure == null && r.arrival == null)) return []
  const transfers: any[] = Array.isArray(r.transfers) ? r.transfers : []
  const legs: any[] = []
  let from = { line: r.line, train: r.train, fromStation: r.fromStation, departure: r.departure, platform: r.platform }
  for (const t of transfers) {
    legs.push({ ...from, toStation: t?.station, arrival: t?.arrival })
    from = { line: t?.line, train: '', fromStation: t?.station, departure: t?.departure, platform: t?.platform }
  }
  legs.push({ ...from, toStation: r.toStation, arrival: r.arrival })
  return legs
}

// The times in the order they happen — each leg's departure and arrival — as minutes, each at or
// after the one before (a time much earlier than the one before is past midnight). null when
// they aren't in order, or the whole trip takes no time or more than half a day.
function timeline(legs: TrainLeg[]): number[] | null {
  const raw = legs.flatMap((l) => [l.departure, l.arrival]).map(minutesOf)
  const out: number[] = []
  let offset = 0
  for (const m of raw) {
    let v = m + offset
    const prev = out[out.length - 1]
    if (prev != null && v < prev) {
      if (prev - v >= 12 * 60 && offset === 0) { offset = 1440; v += 1440 } // past midnight, once
      else return null
    }
    out.push(v)
  }
  return out[out.length - 1] > out[0] && out[out.length - 1] - out[0] <= 12 * 60 ? out : null
}

export const TRAIN_ORDER_ERROR = 'The times must be in order: each leg departs before it arrives, and the next leg departs after that.'

// A train trip from the editor, a screenshot reading or a saved plan (either shape): at least one
// leg, every time a valid "HH:MM", all in order across the legs. Texts trimmed and shortened;
// only the times are required.
export function validateTrain(raw: unknown): { train: TrainPlan } | { error: string } {
  const r: any = raw && typeof raw === 'object' ? raw : null
  if (!r) return { error: 'No train' }
  const rawLegs = legsOf(r).slice(0, MAX_LEGS)
  if (!rawLegs.length) return { error: 'Add at least one train.' }
  const legs: TrainLeg[] = []
  for (const [i, l] of rawLegs.entries()) {
    const mode = typeof l?.mode === 'string' ? l.mode.trim().toLowerCase() : ''
    const direction = text(l?.direction)
    const leg: TrainLeg = {
      // A train is the default: saved only for the other modes, so a train leg saves as before.
      ...(isMode(mode) && mode !== 'train' ? { mode } : {}),
      ...(direction ? { direction } : {}),
      line: text(l?.line), train: text(l?.train), fromStation: text(l?.fromStation), departure: clockText(l?.departure),
      platform: text(l?.platform), toStation: text(l?.toStation), arrival: clockText(l?.arrival),
    }
    const which = rawLegs.length > 1 ? `Train ${i + 1}: ` : ''
    if (!HHMM.test(leg.departure)) return { error: `${which}the departure time must be HH:MM.` }
    if (!HHMM.test(leg.arrival)) return { error: `${which}the arrival time must be HH:MM.` }
    legs.push(leg)
  }
  const train: TrainPlan = { legs }
  const minutes = (v: unknown) => { const n = Number(v); return v !== '' && v != null && Number.isInteger(n) && n >= 0 && n <= 60 ? n : null }
  const walkTo = minutes(r.walkToStationMin)
  if (walkTo != null) train.walkToStationMin = walkTo
  const walkFrom = minutes(r.walkFromStationMin)
  if (walkFrom != null) train.walkFromStationMin = walkFrom
  // "¥6,670", "6670" or 6670.
  const fare = typeof r.fareYen === 'number' ? r.fareYen : typeof r.fareYen === 'string' && /\d/.test(r.fareYen) ? Number(r.fareYen.replace(/[^\d]/g, '')) : NaN
  if (Number.isInteger(fare) && fare > 0 && fare <= MAX_FARE_YEN) train.fareYen = fare
  const travelers = Number(r.travelers)
  if (r.travelers !== '' && r.travelers != null && Number.isInteger(travelers) && travelers >= 1 && travelers <= MAX_TRAVELERS) train.travelers = travelers
  if (!timeline(legs)) return { error: TRAIN_ORDER_ERROR }
  return { train }
}

// The schedule's view (itinerary-schedule.ts TrainTimes): minutes, the first departure and the
// last arrival (after it — past midnight when it runs over).
export function trainTimes(t: unknown): { departure: number; arrival: number; walkToStationMin: number | null; walkFromStationMin: number } | null {
  if (!t) return null
  const v = validateTrain(t)
  if ('error' in v) return null
  const times = timeline(v.train.legs)!
  return {
    departure: times[0], arrival: times[times.length - 1],
    walkToStationMin: v.train.walkToStationMin ?? null,
    walkFromStationMin: v.train.walkFromStationMin ?? DEFAULT_WALK_FROM_STATION_MIN,
  }
}

// The leg's travel time with this train, as Google Maps counts it: the walk to the first
// station, the first departure to the last arrival, the walk from the last station (not the
// wait for the train). The real route: 5 + 83 + 12 = 100 min ("1 hr 40 min").
export function trainTravelMinutes(t: unknown): number | null {
  const x = trainTimes(t)
  return x ? (x.walkToStationMin ?? 0) + (x.arrival - x.departure) + x.walkFromStationMin : null
}

// The time on the train: the first departure to the last arrival (changes included). The real
// route: Shinjuku-sanchome 11:32 → Minatomirai 12:11 = 39 min.
export function trainRideMinutes(t: unknown): number | null {
  const x = trainTimes(t)
  return x ? x.arrival - x.departure : null
}
// One leg's time on the train (past midnight when it runs over).
export function trainLegMinutes(l: TrainLeg): number {
  return (minutesOf(l.arrival) - minutesOf(l.departure) + 1440) % 1440
}
// "⏱ 39 min on the train · 58 min door to door" (door to door: trainTravelMinutes — 15 min walk +
// 39 + 4). Without a known walk to the first station, the time on the train only: door to door
// would leave that walk out. '' when it isn't a valid train.
export function trainDurationText(t: unknown): string {
  const x = trainTimes(t)
  if (!x) return ''
  const ride = `⏱ ${x.arrival - x.departure} min on the train`
  return x.walkToStationMin == null ? ride : `${ride} · ${trainTravelMinutes(t)} min door to door`
}

// "¥6,670"; with a rate "¥6,670 (≈ 427 kr)".
export function formatYen(yen: number): string {
  return `¥${Math.round(yen).toLocaleString('en-US')}`
}
export function yenWithNok(yen: number, rate: number | null | undefined): string {
  return `${formatYen(yen)}${rate && rate > 0 ? ` (≈ ${Math.round(yen * rate).toLocaleString('en-US')} kr)` : ''}`
}
// "¥6,670 per person (≈ 427 kr)" — the trip's fare; '' when it has none.
// With `tripTravelers` (the trip's number; the train's own wins), the group's fare too:
// "¥6,670 per person (≈ 427 kr) · ¥6,670 × 5 = ¥33,350".
export function trainFareText(t: unknown, rate: number | null | undefined, tripTravelers?: number | null): string {
  const v = t ? validateTrain(t) : null
  const fare = v && 'train' in v ? v.train.fareYen : undefined
  if (!fare) return ''
  const perPerson = `${formatYen(fare)} per person${rate && rate > 0 ? ` (≈ ${Math.round(fare * rate).toLocaleString('en-US')} kr)` : ''}`
  if (tripTravelers === undefined) return perPerson
  const n = (v as { train: TrainPlan }).train.travelers ?? tripTravelers ?? DEFAULT_TRAVELERS
  return `${perPerson} · ${formatYen(fare)} × ${n} = ${formatYen(fare * n)}`
}

// The first departure ("HH:MM"), for the reminder and the band ('' when unreadable).
export function trainDeparture(t: unknown): string {
  const v = t ? validateTrain(t) : null
  return v && 'train' in v ? v.train.legs[0].departure : ''
}

// A line's short name: "Yamanote Line" -> "Yamanote", "Tokaido Shinkansen" -> "Shinkansen".
// A through service ("Keihin-Tōhoku Line / Negishi Line") shortens each name: "Keihin-Tōhoku / Negishi".
const shortLine = (line: string) => (/shinkansen/i.test(line) ? 'Shinkansen' : line.split(/\s*\/\s*/).map((p) => p.replace(/\s+line$/i, '').trim()).filter(Boolean).join(' / '))
// A train worth naming: "Hikari 701", not "local".
const named = (train: string) => !!train && !/^(local|普通|各駅停車)$/i.test(train.trim())

// A leg's icon: 🚆, or 🚌 for a bus (MODE_ICON).
export const legIcon = (l: Pick<TrainLeg, 'mode'>): string => MODE_ICON[l.mode && isMode(l.mode) ? l.mode : 'train']
// The trip's icon (the timeline's band): its first leg's. 🚆 when unreadable.
export function trainIcon(t: unknown): string {
  const v = t ? validateTrain(t) : null
  return v && 'train' in v ? legIcon(v.train.legs[0]) : '🚆'
}

// "🚆 06:47 Yamanote → Tokyo · 07:03 Shinkansen Hikari 701 (15) → Shizuoka · 08:07 Tokaido →
// Higashi-Shizuoka 08:10" — each leg's departure, line (and train and platform when it's a named
// train), where it goes; the last arrival at the end. Blocks cut it off with "…". A trip that
// isn't all trains has each leg's own icon: "🚆 08:39 Keihin-Tōhoku / Negishi → Kannai · 🚌 09:44
// Route 106 → Wadayama-guchi 10:00".
export function trainSummary(t: unknown): string {
  const v = t ? validateTrain(t) : null
  if (!v || 'error' in v) return '🚆'
  const legs = v.train.legs
  const mixed = legs.some((l) => l.mode && l.mode !== 'train')
  const parts = legs.map((l) => {
    const name = [shortLine(l.line), named(l.train) ? l.train : ''].filter(Boolean).join(' ')
    const platform = named(l.train) && l.platform ? ` (${l.platform})` : ''
    return `${mixed ? `${legIcon(l)} ` : ''}${l.departure}${name ? ` ${name}` : ''}${platform}${l.toStation ? ` → ${l.toStation}` : ''}`
  })
  return `${mixed ? '' : '🚆 '}${parts.join(' · ')} ${legs[legs.length - 1].arrival}`
}

// One leg in full, as the editor's card and the sheet show it:
// "1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51". `withMinutes` (the sheet,
// for a trip with several legs): its time on the train after it, " · 4 min". Only a real true: a
// .map(trainLegText) passes the array third.
export function trainLegText(l: TrainLeg, i: number, withMinutes = false): string {
  const name = [l.line, l.train].filter(Boolean).join(' ')
  // Not a train: its icon first, "2. 🚌 Route 106 · …".
  const icon = l.mode && l.mode !== 'train' ? `${legIcon(l)} ` : ''
  return `${i + 1}. ${icon}${name ? `${name} · ` : ''}${l.fromStation ? `${l.fromStation} ` : ''}${l.departure}${l.platform ? ` (platform ${l.platform})` : ''} → ${l.toStation ? `${l.toStation} ` : ''}${l.arrival}${withMinutes === true ? ` · ${trainLegMinutes(l)} min` : ''}`
}

// --- Reading a train from a screenshot (/api/train-from-screenshot) ---------------------------
export const TRAIN_SCREENSHOT_PROMPT = `The image is a screenshot of a public-transport route in Japan (Google Maps, Navitime, Jorudan, a station app or similar). Read the whole journey shown in it, one leg at a time, in order.

Every public-transport segment is a leg: trains, subways, buses, trams, ferries and monorails alike. A leg where the screenshot says to stay on board / continue on the same vehicle (a through service, e.g. "Keihin-Tōhoku Line" continuing as "Negishi Line") is ONE leg, with both line names. Walks between legs are not legs.

Respond with ONLY a JSON object (no other text, no markdown code fences) with exactly these fields:
- walkToStationMin: the walk to the first station in minutes, as a number, when the screenshot shows it; otherwise null.
- walkFromStationMin: the walk from the last station to the destination in minutes, as a number, when the screenshot shows it (or it follows from the arrival time at the station and at the destination); otherwise null.
- fareYen: the fare for the whole trip per person in yen, as a number (e.g. 6670 for "¥6,670"), when shown; otherwise null.
- legs: an array, one object per vehicle ridden, in order (do not stop after the first leg — include every bus, tram or other leg that follows), each with:
  - mode: "train", "subway", "bus", "tram", "ferry" or "monorail".
  - line: the line or route, e.g. "Yamanote Line", "Tokaido Shinkansen", "Route 106"; a through service as "Keihin-Tōhoku Line / Negishi Line". "" if not shown.
  - direction: toward where (the direction or destination shown), e.g. "Ōfuna". "" if not shown.
  - train: that train's name or number, e.g. "Hikari 701", "Rapid 1234", or "local". "" if not shown.
  - fromStation: where you board it (station or stop). "" if not shown.
  - departure: its departure time, 24-hour "HH:MM".
  - platform: its platform, e.g. "15". "" if not shown.
  - toStation: where you get off (station or stop). "" if not shown.
  - arrival: its arrival time there, 24-hour "HH:MM".

Read only what the screenshot shows; never invent times. If a time can't be read, use "" for it.`

// More than one image: parts of the same route, in order (a tall screenshot cut in overlapping
// pieces, and/or the next screenshots after scrolling).
export const TRAIN_SCREENSHOTS_NOTE = 'The images are parts of the same route, in order: pieces of one tall screenshot that overlap, and/or the following screenshots after scrolling. A row that appears in two images is the same row — read it once. Combine them into one journey.'

// The model's text -> a validated train, or why not. The answer may come wrapped in a code fence
// or after some other text; only a JSON object counts, and only when every time is valid HH:MM
// and in order (validateTrain).
export function trainFromModelText(text: string): { train: TrainPlan } | { error: string } {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: unknown = null
  try { parsed = JSON.parse(cleaned) } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) { try { parsed = JSON.parse(match[0]) } catch {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'Could not read a train from the screenshot.' }
  return validateTrain(parsed)
}
