// Calendar dates for the trip ("YYYY-MM-DD", as Sanity stores a `date` field), and the one
// place that turns them into weekdays and labels — the list's (/itinerary-list) day headings, its "Not
// scheduled" section and /api/itinerary-review all use these, so they can't disagree.
//
// A calendar date has no time and no timezone. Everything here works on the year/month/day
// numbers through Date.UTC, never `new Date("2026-12-01")` + local getters: that parses as
// UTC midnight and then reads the day back in the device's own timezone, which is the
// previous day anywhere west of UTC.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// The date's own year/month/day, or null if it isn't a real calendar date (e.g. 2026-02-30).
export function parseIsoDate(iso: unknown): { y: number; m: number; d: number } | null {
  const match = typeof iso === 'string' ? ISO_DATE.exec(iso) : null
  if (!match) return null
  const y = +match[1], m = +match[2], d = +match[3]
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return { y, m, d }
}

export function isIsoDate(iso: unknown): iso is string {
  return parseIsoDate(iso) !== null
}

function toIso(t: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

export function addDays(iso: string, days: number): string {
  const p = parseIsoDate(iso)
  if (!p) throw new Error(`Not a calendar date: ${iso}`)
  return toIso(new Date(Date.UTC(p.y, p.m - 1, p.d + days)))
}

// 0 = Sunday … 6 = Saturday.
export function weekdayIndex(iso: string): number {
  const p = parseIsoDate(iso)
  if (!p) throw new Error(`Not a calendar date: ${iso}`)
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
}

// Every date from `first` to `last`, both included; [] if either is missing/invalid or
// last is before first. Capped (a trip of a few weeks at most) so a typo in Studio can't
// produce thousands of days.
export const MAX_RANGE_DAYS = 60
export function dateRange(first: unknown, last: unknown): string[] {
  if (!isIsoDate(first) || !isIsoDate(last) || last < first) return []
  const days: string[] = []
  for (let d = first; d <= last && days.length < MAX_RANGE_DAYS; d = addDays(d, 1)) days.push(d)
  return days
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS_NO_SHORT = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør']
const MONTHS_NO_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

export function weekdayName(iso: string): string {
  return WEEKDAYS_EN[weekdayIndex(iso)]
}

// "Tuesday 1 December 2026" — for the AI review's input.
export function formatDateLong(iso: string): string {
  const p = parseIsoDate(iso)!
  return `${weekdayName(iso)} ${p.d} ${MONTHS_EN[p.m - 1]} ${p.y}`
}

// "1. des (tir)" — the itinerary's day headings, in the page's own (Norwegian) style.
export function formatDayLabel(iso: string): string {
  const p = parseIsoDate(iso)!
  return `${p.d}. ${MONTHS_NO_SHORT[p.m - 1]} (${WEEKDAYS_NO_SHORT[weekdayIndex(iso)]})`
}

// --- Japan time ----------------------------------------------------------------------------
// The itinerary's times are Tokyo wall-clock times on a calendar date. Japan has no daylight
// saving, so Asia/Tokyo is always UTC+9 — these convert without any timezone database and give
// the same answer whatever timezone the phone is set to.
export const TRIP_TIMEZONE = 'Asia/Tokyo'
const TOKYO_OFFSET_MIN = 9 * 60

// The moment a Tokyo time happens: ("2026-12-06", 17*60+37) -> 2026-12-06T08:37:00Z.
export function tokyoInstant(iso: string, minutes: number): Date {
  const p = parseIsoDate(iso)
  if (!p) throw new Error(`Not a calendar date: ${iso}`)
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 0, minutes) - TOKYO_OFFSET_MIN * 60000)
}

// The date and time it is in Tokyo at `now` (minutes after midnight).
export function tokyoNow(now: Date = new Date()): { date: string; minutes: number } {
  const t = new Date(now.getTime() + TOKYO_OFFSET_MIN * 60000)
  return { date: toIso(t), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() }
}

// "2026-12-05T14:00" read as a Tokyo date and time (the timeline's ?now= test mode); null when it
// isn't one.
export function parseTokyoDateTime(s: unknown): { date: string; minutes: number } | null {
  const m = typeof s === 'string' ? /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim()) : null
  if (!m || !isIsoDate(m[1])) return null
  return { date: m[1], minutes: +m[2] * 60 + +m[3] }
}

// "Thu 3 Dec" — short, in English (the timeline's "Move to…" list).
const WEEKDAYS_EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function formatDayShortEn(iso: string): string {
  const p = parseIsoDate(iso)
  if (!p) return iso
  return `${WEEKDAYS_EN_SHORT[weekdayIndex(iso)]} ${p.d} ${MONTHS_EN_SHORT[p.m - 1]}`
}

// A short range of days for a trip button: "1.–6. des" within a month, "21. feb–5. mar" across,
// and the year on both ends across a new year ("28. des 2026–3. jan 2027").
export function shortDateRange(first: string, last: string): string {
  const [y1, m1, d1] = first.split('-').map(Number)
  const [y2, m2, d2] = last.split('-').map(Number)
  if (!y1 || !y2) return ''
  if (y1 !== y2) return `${d1}. ${MONTHS_NO_SHORT[m1 - 1]} ${y1}–${d2}. ${MONTHS_NO_SHORT[m2 - 1]} ${y2}`
  if (m1 === m2) return d1 === d2 ? `${d1}. ${MONTHS_NO_SHORT[m1 - 1]}` : `${d1}.–${d2}. ${MONTHS_NO_SHORT[m1 - 1]}`
  return `${d1}. ${MONTHS_NO_SHORT[m1 - 1]}–${d2}. ${MONTHS_NO_SHORT[m2 - 1]}`
}
