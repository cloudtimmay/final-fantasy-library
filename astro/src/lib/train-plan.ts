// A chosen train on an itinerary leg — "🚆 Plan train" on the timeline. Stored on the stop AFTER
// the leg (\`train\` on the saved stop, like the manual travel time), entered by hand or read from
// a screenshot of a route (/api/train-from-screenshot). The schedule (itinerary-schedule.ts)
// takes the departure as the leg's anchor and starts the next stop after the final arrival.
// Pure: validation, the times in minutes, and the one-line summary.

export type TrainTransfer = {
  station: string // where you change
  line: string // the line you change to
  arrival: string // "HH:MM" you get there
  departure: string // "HH:MM" the next train leaves
  platform: string
}
export type TrainPlan = {
  line: string
  train: string // name or number, e.g. "Rapid 1234"
  fromStation: string
  departure: string // "HH:MM"
  platform: string
  toStation: string
  arrival: string // "HH:MM" at toStation, after any transfers
  walkToStationMin?: number // from the stop before to the station, when known
  transfers: TrainTransfer[]
}

export const MAX_TRANSFERS = 4
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

// The times in the order they happen: departure, then each transfer's arrival and departure,
// then the final arrival — as minutes, each at or after the one before (a time much earlier than
// the one before is past midnight). null when they aren't in order.
function timeline(t: { departure: string; arrival: string; transfers: TrainTransfer[] }): number[] | null {
  const raw = [t.departure, ...t.transfers.flatMap((x) => [x.arrival, x.departure]), t.arrival].map(minutesOf)
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
  // The whole trip: some time must pass, and not more than half a day.
  return out[out.length - 1] > out[0] && out[out.length - 1] - out[0] <= 12 * 60 ? out : null
}

// A train from the form, a screenshot reading or a saved plan: every time a valid "HH:MM" and in
// order. Texts trimmed and shortened; empty texts allowed (only the times are required).
export function validateTrain(raw: unknown): { train: TrainPlan } | { error: string } {
  const r: any = raw && typeof raw === 'object' ? raw : null
  if (!r) return { error: 'No train' }
  const departure = clockText(r.departure)
  const arrival = clockText(r.arrival)
  if (!HHMM.test(departure)) return { error: 'The departure time must be HH:MM.' }
  if (!HHMM.test(arrival)) return { error: 'The arrival time must be HH:MM.' }
  const rawTransfers: any[] = Array.isArray(r.transfers) ? r.transfers.slice(0, MAX_TRANSFERS) : []
  const transfers: TrainTransfer[] = []
  for (const [i, x] of rawTransfers.entries()) {
    const tr = { station: text(x?.station), line: text(x?.line), arrival: clockText(x?.arrival), departure: clockText(x?.departure), platform: text(x?.platform) }
    if (!HHMM.test(tr.arrival) || !HHMM.test(tr.departure)) return { error: `Transfer ${i + 1}: its times must be HH:MM.` }
    transfers.push(tr)
  }
  const train: TrainPlan = {
    line: text(r.line), train: text(r.train), fromStation: text(r.fromStation), departure, platform: text(r.platform),
    toStation: text(r.toStation), arrival, transfers,
  }
  const walk = Number(r.walkToStationMin)
  if (r.walkToStationMin !== '' && r.walkToStationMin != null && Number.isInteger(walk) && walk >= 0 && walk <= 60) train.walkToStationMin = walk
  if (!timeline(train)) return { error: 'The times must be in order: departure, each transfer, then arrival.' }
  return { train }
}

// The schedule's view (itinerary-schedule.ts TrainTimes): minutes, the arrival after the departure.
export function trainTimes(t: TrainPlan | null | undefined): { departure: number; arrival: number; walkToStationMin: number | null } | null {
  if (!t) return null
  const v = validateTrain(t)
  if ('error' in v) return null
  const times = timeline(v.train)!
  return { departure: times[0], arrival: times[times.length - 1], walkToStationMin: v.train.walkToStationMin ?? null }
}

// "🚆 Yamanote Line Rapid 1234 · 17:42 platform 3 → Shinjuku 18:05 · +1 transfer"
export function trainSummary(t: TrainPlan): string {
  const name = [t.line, t.train].filter(Boolean).join(' ')
  const n = t.transfers.length
  return `🚆 ${name ? `${name} · ` : ''}${t.departure}${t.platform ? ` platform ${t.platform}` : ''} → ${t.toStation ? `${t.toStation} ` : ''}${t.arrival}${n ? ` · +${n} transfer${n === 1 ? '' : 's'}` : ''}`
}
