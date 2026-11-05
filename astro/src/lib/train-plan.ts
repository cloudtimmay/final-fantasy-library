// A chosen train trip on an itinerary leg — "🚆 Plan train" on the timeline. Stored on the stop
// AFTER the leg (`train` on the saved stop, like the manual travel time), entered by hand or read
// from a screenshot of a route (/api/train-from-screenshot). Like Google Maps shows a route: an
// ordered list of train legs (Yamanote Line → Tokaido Shinkansen Hikari 701 → Tokaido Line), plus
// the walk to the first station. The schedule (itinerary-schedule.ts) takes the first departure as
// the leg's anchor and starts the next stop after the last arrival.
// Pure: reading (old saves included), validation, the times in minutes, and how it's shown.

export type TrainLeg = {
  line: string // "Tokaido Shinkansen"
  train: string // name or number, e.g. "Hikari 701"; "local"
  fromStation: string
  departure: string // "HH:MM"
  platform: string
  toStation: string
  arrival: string // "HH:MM"
}
export type TrainPlan = {
  walkToStationMin?: number // from the stop before to the first station, when known
  legs: TrainLeg[]
}

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
    const leg = {
      line: text(l?.line), train: text(l?.train), fromStation: text(l?.fromStation), departure: clockText(l?.departure),
      platform: text(l?.platform), toStation: text(l?.toStation), arrival: clockText(l?.arrival),
    }
    const which = rawLegs.length > 1 ? `Train ${i + 1}: ` : ''
    if (!HHMM.test(leg.departure)) return { error: `${which}the departure time must be HH:MM.` }
    if (!HHMM.test(leg.arrival)) return { error: `${which}the arrival time must be HH:MM.` }
    legs.push(leg)
  }
  const train: TrainPlan = { legs }
  const walk = Number(r.walkToStationMin)
  if (r.walkToStationMin !== '' && r.walkToStationMin != null && Number.isInteger(walk) && walk >= 0 && walk <= 60) train.walkToStationMin = walk
  if (!timeline(legs)) return { error: TRAIN_ORDER_ERROR }
  return { train }
}

// The schedule's view (itinerary-schedule.ts TrainTimes): minutes, the first departure and the
// last arrival (after it — past midnight when it runs over).
export function trainTimes(t: unknown): { departure: number; arrival: number; walkToStationMin: number | null } | null {
  if (!t) return null
  const v = validateTrain(t)
  if ('error' in v) return null
  const times = timeline(v.train.legs)!
  return { departure: times[0], arrival: times[times.length - 1], walkToStationMin: v.train.walkToStationMin ?? null }
}

// The first departure ("HH:MM"), for the reminder and the band ('' when unreadable).
export function trainDeparture(t: unknown): string {
  const v = t ? validateTrain(t) : null
  return v && 'train' in v ? v.train.legs[0].departure : ''
}

// A line's short name: "Yamanote Line" -> "Yamanote", "Tokaido Shinkansen" -> "Shinkansen".
const shortLine = (line: string) => (/shinkansen/i.test(line) ? 'Shinkansen' : line.replace(/\s+line$/i, '').trim())
// A train worth naming: "Hikari 701", not "local".
const named = (train: string) => !!train && !/^(local|普通|各駅停車)$/i.test(train.trim())

// "🚆 06:47 Yamanote → Tokyo · 07:03 Shinkansen Hikari 701 (15) → Shizuoka · 08:07 Tokaido →
// Higashi-Shizuoka 08:10" — each leg's departure, line (and train and platform when it's a named
// train), where it goes; the last arrival at the end. Blocks cut it off with "…".
export function trainSummary(t: unknown): string {
  const v = t ? validateTrain(t) : null
  if (!v || 'error' in v) return '🚆'
  const legs = v.train.legs
  const parts = legs.map((l) => {
    const name = [shortLine(l.line), named(l.train) ? l.train : ''].filter(Boolean).join(' ')
    const platform = named(l.train) && l.platform ? ` (${l.platform})` : ''
    return `${l.departure}${name ? ` ${name}` : ''}${platform}${l.toStation ? ` → ${l.toStation}` : ''}`
  })
  return `🚆 ${parts.join(' · ')} ${legs[legs.length - 1].arrival}`
}

// One leg in full, as the editor's card and the sheet show it:
// "1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51".
export function trainLegText(l: TrainLeg, i: number): string {
  const name = [l.line, l.train].filter(Boolean).join(' ')
  return `${i + 1}. ${name ? `${name} · ` : ''}${l.fromStation ? `${l.fromStation} ` : ''}${l.departure}${l.platform ? ` (platform ${l.platform})` : ''} → ${l.toStation ? `${l.toStation} ` : ''}${l.arrival}`
}

// --- Reading a train from a screenshot (/api/train-from-screenshot) ---------------------------
export const TRAIN_SCREENSHOT_PROMPT = `The image is a screenshot of a public-transport route in Japan (Google Maps, Navitime, Jorudan, a station app or similar). Read the journey shown in it, one train at a time, in order.

Respond with ONLY a JSON object (no other text, no markdown code fences) with exactly these fields:
- walkToStationMin: the walk to the first station in minutes, as a number, when the screenshot shows it; otherwise null.
- legs: an array, one object per train ridden, in order, each with:
  - line: the line, e.g. "Yamanote Line", "Tokaido Shinkansen". "" if not shown.
  - train: that train's name or number, e.g. "Hikari 701", "Rapid 1234", or "local". "" if not shown.
  - fromStation: where you board it. "" if not shown.
  - departure: its departure time, 24-hour "HH:MM".
  - platform: its platform, e.g. "15". "" if not shown.
  - toStation: where you get off. "" if not shown.
  - arrival: its arrival time there, 24-hour "HH:MM".

Read only what the screenshot shows; never invent times. If a time can't be read, use "" for it.`

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
