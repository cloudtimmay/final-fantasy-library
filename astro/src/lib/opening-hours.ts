// Opening hours: the one parser for a shop's free-text hours, and the check of a planned visit
// against them. Used by /itinerary (the timeline), /itinerary-list, Check day
// (/api/itinerary-review), Suggest route (route-optimizer.ts) and the AI "Fill in from web"
// validation (/api/shop-info). Pure, no dependencies.
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
// Public holidays (祝日) can't be known for a date, so hours given only for them are ignored.
//
// Minutes after midnight throughout; a range past midnight ends after 1440 (18:00–02:00 is
// 1080–1560), and "open 24 hours" is 0–1440.

export type TimeRange = { start: number; end: number }
// One weekday: closed, or open in these ranges.
export type DayHours = { closed: true; ranges: [] } | { closed: false; ranges: TimeRange[] }
export type OpeningHours = {
  text: string
  // 0 = Sunday … 6 = Saturday (lib/trip-dates.ts weekdayIndex); null = not known for that day.
  days: (DayHours | null)[]
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
  const tokens = tokenize(normalize(raw))

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
  const suffixMode = meaningful[0]?.t === 'range' && meaningful[meaningful.length - 1]?.t === 'days' &&
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
  return { text: raw, days: result, irregular, unparsed }
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
  | { kind: 'before-open'; opens: number; arrival: number }
  | { kind: 'after-close'; closes: number; arrival: number }
  | { kind: 'closes-during'; closes: number; leave: number }

// `weekday` is the visit's date (0 = Sunday); `arrival` and `leave` are minutes after midnight
// on that date and may run past 1440 (a visit after midnight is on the next weekday, and the
// previous evening's hours past midnight count). Without a weekday, only hours that are the
// same every day are used.
export function checkVisit(h: OpeningHours | null, weekday: number | null, arrival: number, leave: number): VisitCheck {
  if (!h) return { kind: 'none' }
  if (h.unparsed) return { kind: 'unparsed' }
  let wd = weekday
  if (wd == null) {
    const same = h.days.every((d) => JSON.stringify(d) === JSON.stringify(h.days[1]))
    if (!same) return { kind: 'unknown' }
    wd = 1
  }
  const dayOf = (k: number) => h.days[((k % 7) + 7) % 7]
  // The visit's calendar day, and the opening intervals around it on one axis: the day before
  // (only what runs past its midnight), the day itself and the next day.
  const offset = Math.floor(arrival / 1440)
  const day = wd + offset
  const t = arrival - offset * 1440
  const end = leave - offset * 1440
  const intervals: TimeRange[] = []
  const prev = dayOf(day - 1), today = dayOf(day), next = dayOf(day + 1)
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
  if (today.closed) return { kind: 'closed-day', weekday: ((day % 7) + 7) % 7 }
  const later = merged.find((r) => r.start > t && r.start < 1440)
  if (later) return { kind: 'before-open', opens: later.start + shift, arrival }
  // After today's last closing (the evening before doesn't count on a normal day).
  return afterClose && before!.start >= 0 ? afterClose : { kind: 'unknown' }
}

// Not open when you get there: what Suggest route counts as a closed-shop arrival.
export function closedOnArrival(c: VisitCheck): boolean {
  return c.kind === 'closed-day' || c.kind === 'before-open' || c.kind === 'after-close'
}

const hhmm = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

// The warning for a visit: a short badge for the timeline block and the full message.
// null when there's nothing to say. "Hours not understood" is a note, not a warning.
export function visitWarning(c: VisitCheck): { badge: string; message: string; note?: boolean } | null {
  switch (c.kind) {
    case 'closed-day': return { badge: 'Closed', message: `Closed on ${WEEKDAYS[c.weekday]}` }
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
export function checkHours(text: string | null | undefined, weekday: number | null, arrival: number, leave: number): VisitCheck {
  const key = String(text || '')
  if (!cache.has(key)) {
    if (cache.size > 500) cache.clear()
    cache.set(key, parseOpeningHours(key))
  }
  return checkVisit(cache.get(key)!, weekday, arrival, leave)
}

// Not open at `plannedMinutes` on any day (weekday unknown): the old yes/no check, for the
// places that don't have a date.
export function looksClosed(text: string | null | undefined, plannedMinutes: number): boolean {
  return closedOnArrival(checkHours(text, null, plannedMinutes, plannedMinutes))
}
