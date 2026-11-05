// Opening hours: the one parser for a shop's free-text hours, and the check of a planned visit
// against them. Used by /itinerary (the timeline), /itinerary-list, Check day
// (/api/itinerary-review), Suggest route (route-optimizer.ts) and the AI "Fill in from web"
// validation (/api/shop-info). Pure.
//
// Understood (English, Japanese and Norwegian, in any mix):
//   time ranges     10:00–20:00, 10:00 - 21:00, 10:00~20:00, 10:00〜20:00, 10時〜20時, 10am-8pm,
//                   several ranges ("11:30-14:00, 17:00-22:00"), past midnight ("18:00-02:00")
//   all day         Open 24 hours, 24h, 24/7, 24時間営業, Døgnåpent
//   weekday hours   Mon–Fri 10:00–20:00, Sat 10:00–18:00 · weekdays/weekends · 平日, 土日, 土日祝,
//                   月〜金 · man–fre, lør, søn, hverdager, helg — the days before their hours,
//                   or (when the text starts with the hours) after them
//   closed days     closed Tue, Tue closed, 定休日 火曜, 火曜定休, stengt mandag, søn stengt
//   unknown         irregular holidays / 不定休 / varies: closed days can't be known
//   dates           "Market 5 / 6 dec 09:00 - 14:30", "Dec 5–6", "12/5, 12/6", 12月5日・6日: open on
//                   those dates only, closed on every other (not after "closed": "closed 12/31")
// Public holidays (祝日) can't be known for a date, so hours given only for them are ignored.
// Remarks never change the hours: anything in brackets — "(some listings show weekday opening
// at 10:30)", "(closes 21:00 Sundays and holidays)" — and a floor's or section's own hours
// ("B1 12:00–22:00", "3F …", "地下1階 …") are left out; the shop's main hours count. The full
// text is still what the pages show.
//
// Minutes after midnight throughout; a range past midnight ends after 1440 (18:00–02:00 is
// 1080–1560), and "open 24 hours" is 0–1440.

import { addDays, isIsoDate } from './trip-dates'

export type TimeRange = { start: number; end: number }
// One weekday: closed, or open in these ranges.
export type DayHours = { closed: true; ranges: [] } | { closed: false; ranges: TimeRange[] }
export type OpeningHours = {
  text: string
  // 0 = Sunday … 6 = Saturday (lib/trip-dates.ts weekdayIndex); null = not known for that day.
  days: (DayHours | null)[]
  // Open only on these dates ("MM-DD"), with the hours above; null = any date.
  dates: string[] | null
  irregular: boolean // irregular closed days: a day not marked closed may still be closed
  unparsed: boolean // there is text, but nothing in it was understood
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ALL = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAY_SET = [1, 2, 3, 4, 5]
const WEEKEND_SET = [0, 6]
const HOLIDAY = -1 // a public holiday: can't be placed on a date, so ignored

// Day words → weekday numbers (or a group). Longest first within each language, so "tues"
// isn't read as "tue" + "s".
const DAY_WORDS: [string, number[]][] = [
  ['sundays', [0]], ['mondays', [1]], ['tuesdays', [2]], ['wednesdays', [3]], ['thursdays', [4]], ['fridays', [5]], ['saturdays', [6]],
  ['sunday', [0]], ['monday', [1]], ['tuesday', [2]], ['wednesday', [3]], ['thursday', [4]], ['friday', [5]], ['saturday', [6]],
  ['tues', [2]], ['thurs', [4]], ['thur', [4]],
  ['sun', [0]], ['mon', [1]], ['tue', [2]], ['wed', [3]], ['thu', [4]], ['fri', [5]], ['sat', [6]],
  ['weekdays', WEEKDAY_SET], ['weekday', WEEKDAY_SET], ['weekends', WEEKEND_SET], ['weekend', WEEKEND_SET],
  ['daily', ALL], ['every day', ALL], ['everyday', ALL],
  ['public holidays', [HOLIDAY]], ['holidays', [HOLIDAY]], ['holiday', [HOLIDAY]],
  ['søndag', [0]], ['mandag', [1]], ['tirsdag', [2]], ['onsdag', [3]], ['torsdag', [4]], ['fredag', [5]], ['lørdag', [6]],
  ['søn', [0]], ['man', [1]], ['tirs', [2]], ['tir', [2]], ['ons', [3]], ['tors', [4]], ['tor', [4]], ['fre', [5]], ['lør', [6]],
  ['hverdager', WEEKDAY_SET], ['hverdag', WEEKDAY_SET], ['helgen', WEEKEND_SET], ['helger', WEEKEND_SET], ['helg', WEEKEND_SET],
  ['alle dager', ALL], ['hver dag', ALL],
]
const JP_DAYS: Record<string, number[]> = { '日': [0], '月': [1], '火': [2], '水': [3], '木': [4], '金': [5], '土': [6] }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LATIN_WORD = (w: string) => `(?<![a-zæøå])${esc(w)}(?![a-zæøå])`

// The tokens, in the order they're tried at each position.
const TOKEN = new RegExp([
  // a time range: both ends need minutes or am/pm (so "1-3F" isn't one)
  '(?<range>(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*-\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?)',
  '(?<allday>open 24 hours|24 hours|24h|24/7|24時間営業|24時間|døgnåpent|døgnåpen)',
  '(?<irregular>irregular(?:ly)?(?:\\s+(?:public\\s+)?(?:holidays?|closures?|closing days|days off))?|不定休|uregelmessig|varies|vary)',
  '(?<closed>closed|定休日|定休|休業日|休業|休み|stengt|lukket)',
  `(?<jpgroup>土日祝日|土日祝|土日|平日|祝日|祝|毎日)`,
  // a single kanji weekday, not a month ("12月") and not part of 休日/祝日/毎日/営業日/本日
  '(?<jpday>(?<![\\d休祝毎業本])[日月火水木金土](?:曜日|曜)?)',
  `(?<day>${DAY_WORDS.map(([w]) => LATIN_WORD(w)).join('|')})`,
  '(?<dash>-)',
].join('|'), 'g')

const JP_GROUPS: Record<string, number[]> = {
  '土日祝日': [6, 0, HOLIDAY], '土日祝': [6, 0, HOLIDAY], '土日': [6, 0], '平日': WEEKDAY_SET,
  '祝日': [HOLIDAY], '祝': [HOLIDAY], '毎日': ALL,
}

function normalize(text: string): string {
  let s = text.normalize('NFKC').toLowerCase()
  // Japanese clock marks: 10時30分 → 10:30, 10時 → 10:00 (not 24時間, "24 hours").
  s = s.replace(/(\d{1,2})時(\d{1,2})分?/g, (_m, h, m) => `${h}:${String(m).padStart(2, '0')}`)
  s = s.replace(/(\d{1,2})時(?!間)/g, '$1:00')
  // "翌5:00" (5:00 the next morning) — a range ending before it starts is past midnight anyway.
  s = s.replace(/翌/g, '')
  // Every kind of dash and wave between two things is a "-"; "10:00 to 20:00" too; Norwegian
  // "10.00" is 10:00.
  s = s.replace(/[–—−‐‑‒―~〜～]/g, '-').replace(/(\d)\s*ー\s*(\d)/g, '$1-$2')
  s = s.replace(/(\d)\s*(?:to|til)\s*(\d)/g, '$1-$2')
  s = s.replace(/(?<![\d.])(\d{1,2})\.(\d{2})(?![\d.])/g, '$1:$2')
  return s
}

// Remarks out (see the top): bracketed text, and the clauses about one floor or section. A
// bracket that only names closed days ("(Tue closed)", "（定休日：水曜日）") or only says the
// closed days are irregular is kept — it's information, not a remark that changes the hours.
const CLOSED_ONLY = new RegExp(`^(?:\\s|[,:/&・、.-]|and|og|on|closed|定休日|定休|休業日|休み|stengt|lukket|[日月火水木金土](?:曜日|曜)?|${DAY_WORDS.map(([w]) => LATIN_WORD(w)).join('|')})+$`)
const HAS_CLOSED = /closed|定休|休業|休み|stengt|lukket/
const IRREGULAR_ONLY = /^\s*(?:irregular(?:ly)?(?:\s+(?:public\s+)?(?:holidays?|closures?|closing days|days off))?|不定休|uregelmessig)\s*$/
function stripRemarks(s: string): string {
  let out = s
  const keepOrDrop = (inner: string) => ((CLOSED_ONLY.test(inner) && HAS_CLOSED.test(inner)) || IRREGULAR_ONLY.test(inner) ? ` ${inner} ` : ' ')
  for (let i = 0; i < 3; i++) out = out.replace(/\(([^()]*)\)|\[([^[\]]*)\]|【([^【】]*)】/g, (_m, a, b, c) => keepOrDrop(a ?? b ?? c ?? ''))
  const FLOOR = /(^|[\s,])(b\d{1,2}f?|\d{1,2}f|\d{1,2}階|地下\d*階?|floor\s*\d+|\d+(?:st|nd|rd|th)\s+floor)(?=[\s:,.\-]|$)/
  return out.split(/[;,、]/).filter((clause) => !FLOOR.test(clause)).join(', ')
}

// --- Dates ("Market 5 / 6 dec") -----------------------------------------------------------------
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, mai: 5,
  june: 6, juni: 6, jun: 6, july: 7, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oktober: 10, oct: 10, okt: 10, november: 11, nov: 11, december: 12, desember: 12, dec: 12, des: 12,
}
const MONTH_RE = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})\\.?`
const DAY_LIST = '(\\d{1,2}\\.?(?:\\s*(?:/|,|-|&|\\+|and|og)\\s*\\d{1,2}\\.?)*)'
const DATE_RES = [
  // "5 / 6 dec", "5-6 dec", "5. des": the days, then the month
  { re: new RegExp(`(?<![\\d:])${DAY_LIST}\\s*${MONTH_RE}(?![a-zæøå])`, 'g'), days: 1, month: 2 },
  // "dec 5-6", "dec 5, 6": the month, then the days
  { re: new RegExp(`(?<![a-zæøå])${MONTH_RE}\\s*${DAY_LIST}(?![\\d:])`, 'g'), month: 1, days: 2 },
]
// The days in "5 / 6", "5-6", "5, 6".
function dayList(text: string): number[] {
  const out: number[] = []
  const parts = text.replace(/\./g, '').split(/\s*(?:\/|,|&|\+|and|og)\s*/)
  for (const p of parts) {
    const span = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(p.trim())
    if (span) { for (let d = +span[1]; d <= +span[2] && d - +span[1] < 31; d++) out.push(d) }
    else if (/^\d{1,2}$/.test(p.trim())) out.push(+p.trim())
  }
  return out.filter((d) => d >= 1 && d <= 31)
}
const mmdd = (m: number, d: number) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
// The dates named in the text (taken out of it); after "closed" they're closed dates, which
// can't be used, so they're only taken out.
function extractDates(s: string): { rest: string; dates: string[] } {
  const dates: string[] = []
  const closedBefore = (text: string, at: number) => /(closed|stengt|休)[^,;]{0,12}$/.test(text.slice(Math.max(0, at - 16), at))
  let rest = s
  const take = (re: RegExp, toDates: (m: RegExpExecArray) => string[]) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray
      const at = args[args.length - 2] as number
      const found = toDates(m)
      if (!found.length) return m[0]
      if (!closedBefore(rest, at)) dates.push(...found)
      return ' '
    })
  }
  for (const { re, days, month } of DATE_RES) {
    take(re, (m) => { const mon = MONTHS[m[month].replace('.', '')]; return mon ? dayList(m[days]).map((d) => mmdd(mon, d)) : [] })
  }
  // 12月5日・6日
  take(/(\d{1,2})月(\d{1,2})日((?:\s*[・、,]\s*\d{1,2}日)*)/g, (m) => {
    const mon = +m[1]
    if (mon < 1 || mon > 12) return []
    return [m[2], ...(m[3].match(/\d{1,2}/g) || [])].map((d) => +d).filter((d) => d >= 1 && d <= 31).map((d) => mmdd(mon, d))
  })
  // 12/5, 12/6 (month/day, as written in Japan)
  take(/(?<![\d:/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d:/])/g, (m) => (+m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31 ? [mmdd(+m[1], +m[2])] : []))
  return { rest, dates: [...new Set(dates)].sort() }
}

function toMinutes(h: number, m: number, ampm: string | undefined): number | null {
  if (m > 59) return null
  if (ampm) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (ampm === 'pm' ? 12 : 0)
  }
  return h * 60 + m
}

type Token =
  | { t: 'range'; range: TimeRange }
  | { t: 'days'; days: number[] }
  | { t: 'closed' } | { t: 'irregular' } | { t: 'dash' }

function tokenize(s: string): Token[] {
  const out: Token[] = []
  for (const m of s.matchAll(TOKEN)) {
    const g = m.groups!
    if (g.range) {
      const [, , h1, m1, ap1, h2, m2, ap2] = m
      if ((m1 == null && !ap1) || (m2 == null && !ap2)) continue
      const start = toMinutes(+h1, m1 != null ? +m1 : 0, ap1)
      let end = toMinutes(+h2, m2 != null ? +m2 : 0, ap2 || (ap1 && !ap2 && m2 == null ? ap1 : undefined))
      if (start == null || end == null || start > 24 * 60 || end > 30 * 60) continue
      // Past midnight only up to 06:00: "10:00 - 8:30" is a typo (for 20:30), not 22 hours
      // open — taking it as such would hide every warning, so it isn't understood instead.
      if (end <= start) { if (end > 360) continue; end += 1440 }
      if (end - start > 1440) continue
      out.push({ t: 'range', range: { start, end } })
    } else if (g.allday) out.push({ t: 'range', range: { start: 0, end: 1440 } })
    else if (g.irregular) out.push({ t: 'irregular' })
    else if (g.closed) out.push({ t: 'closed' })
    else if (g.jpgroup) out.push({ t: 'days', days: JP_GROUPS[g.jpgroup] })
    else if (g.jpday) out.push({ t: 'days', days: JP_DAYS[g.jpday[0]] })
    else if (g.day) out.push({ t: 'days', days: DAY_WORDS.find(([w]) => w === g.day)![1] })
    else if (g.dash) out.push({ t: 'dash' })
  }
  // "Mon - Fri": a span of days (wrapping past Sunday); a dash anywhere else means nothing.
  const merged: Token[] = []
  for (let i = 0; i < out.length; i++) {
    const a = out[i], d = out[i + 1], b = out[i + 2]
    if (a.t === 'days' && d?.t === 'dash' && b?.t === 'days' && a.days.length === 1 && b.days.length === 1 && a.days[0] >= 0 && b.days[0] >= 0) {
      const span: number[] = []
      for (let k = a.days[0]; ; k = (k + 1) % 7) { span.push(k); if (k === b.days[0] || span.length > 7) break }
      merged.push({ t: 'days', days: span })
      i += 2
    } else if (a.t !== 'dash') merged.push(a)
  }
  return merged
}

export function parseOpeningHours(text: string | null | undefined): OpeningHours | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const { rest, dates } = extractDates(stripRemarks(normalize(raw)))
  const tokens = tokenize(rest)

  const byDay: (TimeRange[] | null)[] = ALL.map(() => null)
  const closed = new Set<number>()
  let fallback: TimeRange[] | null = null // hours given without days: every day without its own
  let irregular = false
  const addRanges = (days: number[] | null, r: TimeRange) => {
    if (!days) { (fallback ||= []).push(r); return }
    for (const d of days) if (d >= 0) (byDay[d] ||= []).push(r)
  }

  // "10:00–20:00 weekdays, 11:00–18:00 weekends": hours first, each followed by its days.
  const meaningful = tokens.filter((x) => x.t !== 'irregular' && !(x.t === 'days' && x.days.every((d) => d === HOLIDAY)))
  // Only when the last days follow hours directly — "…, closed Mon" at the end isn't this.
  const suffixMode = meaningful[0]?.t === 'range' && meaningful[meaningful.length - 1]?.t === 'days' &&
    meaningful[meaningful.length - 2]?.t === 'range' &&
    meaningful.some((x, i) => x.t === 'days' && meaningful[i - 1]?.t === 'range')

  if (suffixMode) {
    let pending: TimeRange[] = []
    let closing = false
    for (const x of tokens) {
      if (x.t === 'range') { if (closing) pending = []; closing = false; pending.push(x.range) }
      else if (x.t === 'closed') closing = true
      else if (x.t === 'irregular') { irregular = true; closing = false }
      else if (x.t === 'days') {
        if (closing) x.days.forEach((d) => d >= 0 && closed.add(d))
        else { pending.forEach((r) => addRanges(x.days, r)); pending = [] }
      }
    }
    pending.forEach((r) => addRanges(null, r))
  } else {
    let days: number[] | null = null // the days the next hours are for (null: no days given)
    let afterRange = false // the last thing read was hours: new days start a new group
    let closing = false // after "closed": the days that follow are closed days …
    let closingDays: number[][] = [] // … except the last of them when hours follow ("closed Tue, Sat 10:00–18:00")
    const flushClosed = () => { closingDays.forEach((ds) => ds.forEach((d) => d >= 0 && closed.add(d))); closingDays = [] }
    for (const x of tokens) {
      if (x.t === 'range') {
        if (closing && closingDays.length) { days = closingDays.pop()!; flushClosed() }
        closing = false
        addRanges(days, x.range)
        afterRange = true
      } else if (x.t === 'days') {
        if (closing) { closingDays.push(x.days); continue }
        if (afterRange || !days) { days = []; afterRange = false }
        days.push(...x.days)
      } else if (x.t === 'closed') {
        flushClosed()
        if (days && !afterRange && days.length) { days.forEach((d) => d >= 0 && closed.add(d)); days = null }
        else closing = true
        afterRange = false
      } else if (x.t === 'irregular') {
        irregular = true
        flushClosed()
        closing = false
      }
    }
    flushClosed()
  }

  const result: (DayHours | null)[] = ALL.map((d) => {
    if (closed.has(d)) return { closed: true, ranges: [] }
    const ranges = byDay[d] || fallback
    return ranges ? { closed: false, ranges: [...ranges].sort((a, b) => a.start - b.start) } : null
  })
  const unparsed = result.every((d) => d == null)
  return { text: raw, days: result, dates: dates.length ? dates : null, irregular, unparsed }
}

// A text worth keeping as a shop's hours: something in it is understood (/api/shop-info).
export function hoursUnderstood(text: string | null | undefined): boolean {
  const h = parseOpeningHours(text)
  return !!h && !h.unparsed
}

// --- A planned visit against the hours ------------------------------------------------------
export type VisitCheck =
  | { kind: 'none' } // no hours given
  | { kind: 'unparsed' } // hours given, but not understood
  | { kind: 'unknown' } // understood, but not for this weekday
  | { kind: 'ok' }
  | { kind: 'closed-day'; weekday: number }
  | { kind: 'closed-date'; dates: string[] } // open only on other dates
  | { kind: 'before-open'; opens: number; arrival: number }
  | { kind: 'after-close'; closes: number; arrival: number }
  | { kind: 'closes-during'; closes: number; leave: number }

// `weekday` is the visit's date (0 = Sunday) and `date` the date itself ("YYYY-MM-DD", for
// hours on given dates only); `arrival` and `leave` are minutes after midnight on that date and
// may run past 1440 (a visit after midnight is on the next weekday, and the previous evening's
// hours past midnight count). Without a weekday, only hours that are the same every day are used.
export function checkVisit(h: OpeningHours | null, weekday: number | null, arrival: number, leave: number, date: string | null = null): VisitCheck {
  if (!h) return { kind: 'none' }
  if (h.unparsed) return { kind: 'unparsed' }
  if (h.dates && !isIsoDate(date)) return { kind: 'unknown' }
  let wd = weekday
  if (wd == null) {
    const same = h.days.every((d) => JSON.stringify(d) === JSON.stringify(h.days[1]))
    if (!same) return { kind: 'unknown' }
    wd = 1
  }
  // On hours for given dates only, a day off those dates is closed.
  const openDate = (delta: number) => !h.dates || h.dates.includes(addDays(date!, Math.floor(arrival / 1440) + delta).slice(5))
  const CLOSED: DayHours = { closed: true, ranges: [] }
  const dayOf = (k: number) => h.days[((k % 7) + 7) % 7]
  // The visit's calendar day, and the opening intervals around it on one axis: the day before
  // (only what runs past its midnight), the day itself and the next day.
  const offset = Math.floor(arrival / 1440)
  const day = wd + offset
  const t = arrival - offset * 1440
  const end = leave - offset * 1440
  const intervals: TimeRange[] = []
  const prev = openDate(-1) ? dayOf(day - 1) : CLOSED, today = openDate(0) ? dayOf(day) : CLOSED, next = openDate(1) ? dayOf(day + 1) : CLOSED
  prev?.ranges.forEach((r) => intervals.push({ start: r.start - 1440, end: r.end - 1440 }))
  today?.ranges.forEach((r) => intervals.push(r))
  next?.ranges.forEach((r) => intervals.push({ start: r.start + 1440, end: r.end + 1440 }))
  intervals.sort((a, b) => a.start - b.start)
  // Back-to-back intervals are one stretch (24 hours every day, or 10–14 and 14–20).
  const merged: TimeRange[] = []
  for (const r of intervals) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  const shift = offset * 1440
  const open = merged.find((r) => r.start <= t && t < r.end)
  if (open) return end > open.end ? { kind: 'closes-during', closes: open.end + shift, leave } : { kind: 'ok' }
  const before = [...merged].reverse().find((r) => r.end <= t)
  const afterClose = before ? { kind: 'after-close' as const, closes: before.end + shift, arrival } : null
  // Past midnight of the planned day it's still that evening's outing: "Closes 22:00", not
  // "Opens 10:00" (the next morning).
  if (offset >= 1 && afterClose && before!.start < 0) return afterClose
  if (!today) return { kind: 'unknown' }
  if (today.closed) return openDate(0) ? { kind: 'closed-day', weekday: ((day % 7) + 7) % 7 } : { kind: 'closed-date', dates: h.dates! }
  const later = merged.find((r) => r.start > t && r.start < 1440)
  if (later) return { kind: 'before-open', opens: later.start + shift, arrival }
  // After today's last closing (the evening before doesn't count on a normal day).
  return afterClose && before!.start >= 0 ? afterClose : { kind: 'unknown' }
}

// Not open when you get there: what Suggest route counts as a closed-shop arrival.
export function closedOnArrival(c: VisitCheck): boolean {
  return c.kind === 'closed-day' || c.kind === 'closed-date' || c.kind === 'before-open' || c.kind === 'after-close'
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateLabel = (md: string) => `${+md.slice(3)} ${MONTH_NAMES[+md.slice(0, 2) - 1]}` // "5 Dec"
const hhmm = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

// The warning for a visit: a short badge for the timeline block and the full message.
// null when there's nothing to say. "Hours not understood" is a note, not a warning.
export function visitWarning(c: VisitCheck): { badge: string; message: string; note?: boolean } | null {
  switch (c.kind) {
    case 'closed-day': return { badge: 'Closed', message: `Closed on ${WEEKDAYS[c.weekday]}` }
    case 'closed-date': return { badge: 'Closed', message: `Open only on ${c.dates.map(dateLabel).join(', ')}` }
    case 'before-open': return { badge: `Opens ${hhmm(c.opens)}`, message: `Opens ${hhmm(c.opens)} (you arrive ${hhmm(c.arrival)})` }
    case 'after-close': return { badge: `Closes ${hhmm(c.closes)}`, message: `Closes ${hhmm(c.closes)} (you arrive ${hhmm(c.arrival)})` }
    case 'closes-during': return { badge: `Closes ${hhmm(c.closes)}`, message: `Closes ${hhmm(c.closes)} (you leave ${hhmm(c.leave)})` }
    case 'unparsed': return { badge: 'Hours not understood', message: 'Hours not understood', note: true }
    default: return null
  }
}

// The one check every page uses: parse (cached — the same few texts are checked over and over,
// thousands of times by Suggest route) and check.
const cache = new Map<string, OpeningHours | null>()
export function checkHours(text: string | null | undefined, weekday: number | null, arrival: number, leave: number, date: string | null = null): VisitCheck {
  const key = String(text || '')
  if (!cache.has(key)) {
    if (cache.size > 500) cache.clear()
    cache.set(key, parseOpeningHours(key))
  }
  return checkVisit(cache.get(key)!, weekday, arrival, leave, date)
}

// "Fill in from web" (/api/shop-info): the hours without bracketed remarks, and those remarks on
// their own (they go to the note suggestion). "10:00–20:00 (closes 21:00 Sundays)" ->
// { hours: "10:00–20:00", remarks: ["closes 21:00 Sundays"] }.
export function splitHoursRemarks(text: string): { hours: string; remarks: string[] } {
  const remarks: string[] = []
  const hours = text
    .replace(/\s*[(（]([^()（）]*)[)）]/g, (_m, r: string) => { if (r.trim()) remarks.push(r.trim()); return '' })
    .replace(/\s+([,;])/g, '$1')
    .replace(/[\s,;]+$/, '')
    .trim()
  return { hours, remarks }
}

// When the shop closes for a visit starting at `start` (minutes, may run past 1440): the end of
// the opening stretch you're in, or of the next one that day. null when it's unknown, closed or
// open around the clock.
export function closingTime(text: string | null | undefined, weekday: number | null, start: number, date: string | null = null): number | null {
  const LONG = 2880
  // Open a whole day or more from then (only the days around the visit are looked at): around the clock.
  const closesAt = (c: VisitCheck, from: number) => (c.kind === 'closes-during' && c.closes - from < 1440 ? c.closes : null)
  const c = checkHours(text, weekday, start, start + LONG, date)
  if (c.kind === 'closes-during') return closesAt(c, start)
  if (c.kind === 'before-open') return closesAt(checkHours(text, weekday, c.opens, c.opens + LONG, date), c.opens)
  return null
}
