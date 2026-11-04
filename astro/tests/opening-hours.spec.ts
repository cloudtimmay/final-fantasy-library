import { test, expect } from '@playwright/test'
import { parseOpeningHours, checkVisit, checkHours, visitWarning, hoursUnderstood, closedOnArrival, type OpeningHours } from '../src/lib/opening-hours'
import { weekdayIndex } from '../src/lib/trip-dates'

const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const r = (a: string, b: string) => ({ start: t(a), end: t(b) < t(a) ? t(b) + 1440 : t(b) })
const open = (...ranges: { start: number; end: number }[]) => ({ closed: false, ranges })
const CLOSED = { closed: true, ranges: [] }
// Sunday … Saturday.
const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6
const days = (h: OpeningHours | null) => h!.days
const warn = (text: string, date: string, arrival: string, leave: string) =>
  visitWarning(checkHours(text, weekdayIndex(date), t(arrival) + (t(arrival) < 360 ? 1440 : 0), t(leave) + (t(leave) < 360 ? 1440 : 0), date))?.message ?? null

test.describe('opening hours (lib/opening-hours.ts): the formats', () => {
  test('dashes: hyphen, en dash, "~" and "〜", with or without spaces; 時; Norwegian dots', () => {
    for (const text of ['10:00-20:00', '10:00 - 20:00', '10:00–20:00', '10:00 – 20:00', '10:00~20:00', '10:00 ~ 20:00', '10:00〜20:00', '10:00 〜 20:00', '10:00～20:00', '10時〜20時', '10.00–20.00', '１０：００～２０：００']) {
      expect(days(parseOpeningHours(text)), text).toEqual(Array(7).fill(open(r('10:00', '20:00'))))
    }
  })

  test('the three real examples', () => {
    expect(days(parseOpeningHours('10:00 - 21:00'))).toEqual(Array(7).fill(open(r('10:00', '21:00'))))
    expect(days(parseOpeningHours('Open 24 hours'))).toEqual(Array(7).fill(open({ start: 0, end: 1440 })))
    const h = days(parseOpeningHours('11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00'))
    expect(h[MON]).toEqual(open(r('11:00', '23:00')))
    expect(h[FRI]).toEqual(open(r('11:00', '23:00')))
    expect(h[SAT]).toEqual(open(r('10:00', '23:00')))
    expect(h[SUN]).toEqual(open(r('10:00', '22:00')))
  })

  test('several time ranges, and am/pm', () => {
    expect(days(parseOpeningHours('11:30-14:00, 17:00-22:00'))[WED]).toEqual(open(r('11:30', '14:00'), r('17:00', '22:00')))
    expect(days(parseOpeningHours('10am-8pm'))[WED]).toEqual(open(r('10:00', '20:00')))
  })

  test('weekday hours in English: ranges of days, weekdays/weekends, hours before or after the days', () => {
    let h = days(parseOpeningHours('Mon–Fri 10:00–20:00, Sat–Sun 11:00–18:00'))
    expect(h[MON]).toEqual(open(r('10:00', '20:00'))); expect(h[FRI]).toEqual(open(r('10:00', '20:00')))
    expect(h[SAT]).toEqual(open(r('11:00', '18:00'))); expect(h[SUN]).toEqual(open(r('11:00', '18:00')))
    h = days(parseOpeningHours('Weekdays 10:00-20:00 / Weekends 11:00-19:00'))
    expect(h[TUE]).toEqual(open(r('10:00', '20:00'))); expect(h[SUN]).toEqual(open(r('11:00', '19:00')))
    h = days(parseOpeningHours('10:00–20:00 weekdays, 11:00–18:00 weekends'))
    expect(h[THU]).toEqual(open(r('10:00', '20:00'))); expect(h[SAT]).toEqual(open(r('11:00', '18:00')))
    h = days(parseOpeningHours('Fri-Mon 12:00-20:00'))
    expect(h[SAT]).toEqual(open(r('12:00', '20:00'))); expect(h[MON]).toEqual(open(r('12:00', '20:00'))); expect(h[TUE]).toBeNull()
    h = days(parseOpeningHours('Mon-Sat 10:00-20:00, Sun & holidays 10:00-19:00'))
    expect(h[SUN]).toEqual(open(r('10:00', '19:00')))
  })

  test('weekday hours in Japanese: 平日, 土日祝, 月〜金, 日曜', () => {
    let h = days(parseOpeningHours('平日 11:00〜20:00 土日祝 10:00〜20:00'))
    expect(h[WED]).toEqual(open(r('11:00', '20:00'))); expect(h[SAT]).toEqual(open(r('10:00', '20:00'))); expect(h[SUN]).toEqual(open(r('10:00', '20:00')))
    h = days(parseOpeningHours('月〜金 10:00〜19:00 土 10:00〜17:00 日曜定休'))
    expect(h[MON]).toEqual(open(r('10:00', '19:00'))); expect(h[SAT]).toEqual(open(r('10:00', '17:00'))); expect(h[SUN]).toEqual(CLOSED)
    h = days(parseOpeningHours('土日 11:00-19:00'))
    expect(h[SUN]).toEqual(open(r('11:00', '19:00'))); expect(h[MON]).toBeNull()
  })

  test('weekday hours and closed days in Norwegian; Døgnåpent', () => {
    const h = days(parseOpeningHours('man–fre 10:00–20:00, lør 10:00–18:00, søn stengt'))
    expect(h[MON]).toEqual(open(r('10:00', '20:00'))); expect(h[FRI]).toEqual(open(r('10:00', '20:00')))
    expect(h[SAT]).toEqual(open(r('10:00', '18:00'))); expect(h[SUN]).toEqual(CLOSED)
    expect(days(parseOpeningHours('Døgnåpent'))).toEqual(Array(7).fill(open({ start: 0, end: 1440 })))
    const s = days(parseOpeningHours('10:00–20:00, stengt mandag'))
    expect(s[MON]).toEqual(CLOSED); expect(s[TUE]).toEqual(open(r('10:00', '20:00')))
    expect(days(parseOpeningHours('Hverdager 10:00-18:00, helg 11:00-16:00'))[SAT]).toEqual(open(r('11:00', '16:00')))
  })

  test('closed days: "closed Tue", "Tue closed", 定休日 火曜, 火曜定休, plurals, and hours after them', () => {
    for (const text of ['10:00–20:00, closed Tue', '10:00–20:00 (Tue closed)', '10:00〜20:00 定休日 火曜', '10:00〜20:00 火曜定休', '10:00～20:00（定休日：火曜日）', '10:00-20:00, closed on Tuesdays']) {
      const h = days(parseOpeningHours(text))
      expect(h[TUE], text).toEqual(CLOSED)
      expect(h[WED], text).toEqual(open(r('10:00', '20:00')))
    }
    const h = days(parseOpeningHours('11:00-20:00, closed Tue, Sat 10:00-18:00'))
    expect(h[TUE]).toEqual(CLOSED); expect(h[SAT]).toEqual(open(r('10:00', '18:00'))); expect(h[MON]).toEqual(open(r('11:00', '20:00')))
  })

  test('irregular holidays: closed days unknown; 24時間営業; unparsed text', () => {
    const irr = parseOpeningHours('11:00–20:00 (irregular holidays)')!
    expect(irr.irregular).toBe(true)
    expect(irr.days).toEqual(Array(7).fill(open(r('11:00', '20:00'))))
    expect(parseOpeningHours('10:00〜20:00 不定休')!.irregular).toBe(true)
    expect(days(parseOpeningHours('24時間営業'))[WED]).toEqual(open({ start: 0, end: 1440 }))
    for (const text of ['By appointment only', 'Check the website', 'Varies']) {
      expect(parseOpeningHours(text)!.unparsed, text).toBe(true)
      expect(hoursUnderstood(text), text).toBe(false)
    }
    expect(parseOpeningHours('')).toBeNull()
    expect(hoursUnderstood('closed Tue')).toBe(true)
    expect(hoursUnderstood('10:00 - 21:00')).toBe(true)
    // A floor number or a date is not a time range.
    expect(parseOpeningHours('1-3F, see website')!.unparsed).toBe(true)
  })

  test('ranges past midnight', () => {
    expect(days(parseOpeningHours('18:00-02:00'))[FRI]).toEqual(open({ start: t('18:00'), end: t('02:00') + 1440 }))
    expect(days(parseOpeningHours('17:00～翌5:00'))[FRI]).toEqual(open({ start: t('17:00'), end: t('05:00') + 1440 }))
    // Ending after 06:00 the next morning: a typo ("10:00 - 8:30" for 20:30), not understood.
    expect(parseOpeningHours('10:00 - 8:30')!.unparsed).toBe(true)
  })
})

test.describe('opening hours: a visit on a given weekday', () => {
  // 1 December 2026 is a Tuesday; 5 December a Saturday; 6 December a Sunday.
  test('the real examples: after closing, closing during the visit, after midnight', () => {
    expect(warn('11:00–20:00', '2026-12-01', '22:13', '22:43')).toBe('Closes 20:00 (you arrive 22:13)') // Kamikaze Style
    expect(warn('10:00–22:00', '2026-12-01', '21:28', '22:08')).toBe('Closes 22:00 (you leave 22:08)') // BicCamera AKIBA
    expect(warn('10:00–22:00', '2026-12-02', '00:12', '00:42')).toBe('Closes 22:00 (you arrive 00:12)') // DAISO after midnight
    expect(warn('10:00–23:30', '2026-12-02', '01:58', '02:58')).toBe('Closes 23:30 (you arrive 01:58)') // Takadanobaba Mikado
  })

  test('before opening, closed that weekday, weekend hours, fine', () => {
    expect(warn('11:00–20:00', '2026-12-01', '09:00', '09:30')).toBe('Opens 11:00 (you arrive 09:00)')
    expect(warn('10:00–20:00, closed Tue', '2026-12-01', '12:00', '13:00')).toBe('Closed on Tuesday')
    expect(warn('10:00–20:00, closed Tue', '2026-12-02', '12:00', '13:00')).toBeNull()
    expect(warn('11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00', '2026-12-05', '10:15', '11:00')).toBeNull() // Saturday: open at 10
    expect(warn('11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00', '2026-12-04', '10:15', '11:00')).toBe('Opens 11:00 (you arrive 10:15)') // Friday
    expect(warn('11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00', '2026-12-06', '21:30', '22:30')).toBe('Closes 22:00 (you leave 22:30)') // Sunday
    expect(warn('Open 24 hours', '2026-12-01', '03:00', '04:00')).toBeNull()
    expect(warn('18:00-02:00', '2026-12-04', '01:00', '01:45')).toBeNull() // still open past midnight
    expect(warn('18:00-02:00', '2026-12-04', '01:30', '02:30')).toBe('Closes 02:00 (you leave 02:30)')
    expect(warn('11:30-14:00, 17:00-22:00', '2026-12-01', '15:00', '16:00')).toBe('Opens 17:00 (you arrive 15:00)')
    expect(warn('11:30-14:00, 17:00-22:00', '2026-12-01', '13:30', '14:30')).toBe('Closes 14:00 (you leave 14:30)')
  })

  test('unknown and unparsed: no warning, only the "Hours not understood" note', () => {
    expect(checkHours('', 2, 600, 660)).toEqual({ kind: 'none' })
    expect(visitWarning(checkHours('By appointment only', 2, 600, 660))).toEqual({ badge: 'Hours not understood', message: 'Hours not understood', note: true })
    expect(checkHours('Sat 10:00-18:00', 2, 600, 660)).toEqual({ kind: 'unknown' }) // nothing for Tuesday
    expect(checkHours('11:00–20:00 (irregular holidays)', 2, 720, 780)).toEqual({ kind: 'ok' })
    // Without a date only hours that are the same every day count.
    expect(checkVisit(parseOpeningHours('11:00-20:00'), null, 540, 570)).toMatchObject({ kind: 'before-open' })
    expect(checkVisit(parseOpeningHours('Mon-Fri 11:00-20:00'), null, 540, 570)).toEqual({ kind: 'unknown' })
  })

  test('what Suggest route counts as closed on arrival', () => {
    expect(closedOnArrival(checkHours('11:00-20:00', 2, 540, 570))).toBe(true) // before opening
    expect(closedOnArrival(checkHours('11:00-20:00', 2, 1300, 1330))).toBe(true) // after closing
    expect(closedOnArrival(checkHours('11:00-20:00, closed Tue', 2, 720, 780))).toBe(true) // closed that day
    expect(closedOnArrival(checkHours('10:00-22:00', 2, 1288, 1328))).toBe(false) // only closes during the visit
  })
})

test.describe('opening hours in Check day and Suggest route', () => {
  test('Check day lists the computed hours problems for the day\'s weekday', async () => {
    const { hoursReviewItems } = await import('../src/lib/itinerary-review-helpers')
    const items = hoursReviewItems(
      ['Kamikaze Style', 'BicCamera AKIBA', 'Closed Saturdays', 'Fine', 'Unknown'],
      ['11:00–20:00', '10:00 - 22:00', '10:00–20:00, closed Sat', '10:00–20:00', 'Lunsj · kontant'],
      weekdayIndex('2026-12-05'), // Saturday
      [{ start: t('22:13'), end: t('22:43') }, { start: t('21:28'), end: t('22:08') }, { start: t('12:00'), end: t('12:45') }, { start: t('12:00'), end: t('13:00') }, { start: t('12:00'), end: t('13:00') }],
    )
    expect(items).toEqual([
      { severity: 'warning', stopIndex: 0, message: 'Kamikaze Style: Closes 20:00 (you arrive 22:13)', suggestion: null },
      { severity: 'warning', stopIndex: 1, message: 'BicCamera AKIBA: Closes 22:00 (you leave 22:08)', suggestion: null },
      { severity: 'warning', stopIndex: 2, message: 'Closed Saturdays: Closed on Saturday', suggestion: 'Move it to another day.' },
    ])
  })

  test('Suggest route counts a shop closed on the day\'s weekday as closed', async () => {
    const { optimizeRoute } = await import('../src/lib/route-optimizer')
    const s = { lat: 35.7, lng: 139.77, durationMin: 60, fixedTime: null, openingHours: '10:00–20:00, closed Sat', note: null }
    expect(optimizeRoute([s], t('12:00'), { lat: 35.7, lng: 139.77 }, weekdayIndex('2026-12-05')).current.closedCount).toBe(1) // Saturday
    expect(optimizeRoute([s], t('12:00'), { lat: 35.7, lng: 139.77 }, weekdayIndex('2026-12-06')).current.closedCount).toBe(0) // Sunday
  })
})

test.describe('opening hours: the real production texts', () => {
  test('remarks in brackets and a floor\'s own hours never change the hours', () => {
    // Darumanome Akihabara
    let h = days(parseOpeningHours('11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00 (some listings show weekday opening at 10:30)'))
    for (const d of [MON, TUE, WED, THU, FRI]) expect(h[d], `day ${d}`).toEqual(open(r('11:00', '23:00')))
    expect(h[SAT]).toEqual(open(r('10:00', '23:00')))
    expect(h[SUN]).toEqual(open(r('10:00', '22:00')))
    // Akihabara Radio Kaikan: the main hours every day, not the B1 floor's
    h = days(parseOpeningHours('10:00–20:00, varies by shop; B1 12:00–22:00 (closes 21:00 Sundays and holidays)'))
    expect(h).toEqual(Array(7).fill(open(r('10:00', '20:00'))))
    // Shizuoka Hobby Square
    h = days(parseOpeningHours('11:00–18:00, weekends and holidays 10:00–18:00, closed Mon (open if Monday is a holiday, closed the next day)'))
    for (const d of [TUE, WED, THU, FRI]) expect(h[d], `day ${d}`).toEqual(open(r('11:00', '18:00')))
    expect(h[SAT]).toEqual(open(r('10:00', '18:00')))
    expect(h[SUN]).toEqual(open(r('10:00', '18:00')))
    expect(h[MON]).toEqual(CLOSED)
    // BHCPDII MUSEUM (already right)
    h = days(parseOpeningHours('09:00–17:30, closed Mon–Tue and national holidays; last admission 16:00; reservation required'))
    expect(h[MON]).toEqual(CLOSED); expect(h[TUE]).toEqual(CLOSED)
    for (const d of [WED, THU, FRI, SAT, SUN]) expect(h[d], `day ${d}`).toEqual(open(r('09:00', '17:30')))
    // TAITO STATION Shinjuku GameWorld: open until 01:00 the next day
    expect(days(parseOpeningHours('10:00 - 01:00'))).toEqual(Array(7).fill(open({ start: t('10:00'), end: t('01:00') + 1440 })))
    expect(warn('10:00 - 01:00', '2026-12-02', '00:20', '00:50')).toBeNull()
  })

  test('Ōimachi Station Market: open 09:00–14:30 on 5 and 6 December only', () => {
    const text = 'Market 5 / 6 dec 09:00 - 14:30'
    expect(parseOpeningHours(text)!.dates).toEqual(['12-05', '12-06'])
    expect(warn(text, '2026-12-05', '10:00', '11:00')).toBeNull()
    expect(warn(text, '2026-12-06', '10:00', '11:00')).toBeNull()
    expect(warn(text, '2026-12-06', '14:00', '15:00')).toBe('Closes 14:30 (you leave 15:00)')
    expect(warn(text, '2026-12-04', '10:00', '11:00')).toBe('Open only on 5 Dec, 6 Dec')
    expect(visitWarning(checkHours(text, weekdayIndex('2026-12-07'), 600, 660, '2026-12-07'))).toEqual({ badge: 'Closed', message: 'Open only on 5 Dec, 6 Dec' })
    // No date: unknown, not closed.
    expect(checkHours(text, null, 600, 660)).toEqual({ kind: 'unknown' })
    expect(closedOnArrival(checkHours(text, weekdayIndex('2026-12-04'), 600, 660, '2026-12-04'))).toBe(true)
  })

  test('other ways of writing dates; "closed" dates are not opening dates', () => {
    expect(parseOpeningHours('Dec 5–6 10:00–16:00')!.dates).toEqual(['12-05', '12-06'])
    expect(parseOpeningHours('12/5, 12/6 10:00-16:00')!.dates).toEqual(['12-05', '12-06'])
    expect(parseOpeningHours('12月5日・6日 10:00〜16:00')!.dates).toEqual(['12-05', '12-06'])
    expect(parseOpeningHours('5. og 6. desember 10:00–16:00')!.dates).toEqual(['12-05', '12-06'])
    expect(days(parseOpeningHours('Dec 5–6 10:00–16:00'))[SAT]).toEqual(open(r('10:00', '16:00')))
    const yearEnd = parseOpeningHours('10:00–20:00, closed 12/31–1/3')!
    expect(yearEnd.dates).toBeNull()
    expect(yearEnd.days[WED]).toEqual(open(r('10:00', '20:00')))
    // Not dates: 24/7 and times.
    expect(parseOpeningHours('24/7')!.dates).toBeNull()
    expect(parseOpeningHours('10:00 - 21:00')!.dates).toBeNull()
  })

  test('"Fill in from web": canonical hours parse; remarks in brackets come out for the note', async () => {
    const { splitHoursRemarks } = await import('../src/lib/opening-hours')
    expect(splitHoursRemarks('10:00–20:00 (closes 21:00 Sundays and holidays)')).toEqual({ hours: '10:00–20:00', remarks: ['closes 21:00 Sundays and holidays'] })
    expect(splitHoursRemarks('Mon–Fri 11:00–23:00, Sat 10:00–23:00（L.O. 22:30）, Sun 10:00–22:00')).toEqual({ hours: 'Mon–Fri 11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00', remarks: ['L.O. 22:30'] })
    expect(splitHoursRemarks('Daily 10:00–20:00')).toEqual({ hours: 'Daily 10:00–20:00', remarks: [] })
    const canonical = days(parseOpeningHours('Mon–Fri 11:00–23:00, Sat 10:00–23:00, Sun 10:00–22:00, closed Tue'))
    expect(canonical[MON]).toEqual(open(r('11:00', '23:00'))); expect(canonical[TUE]).toEqual(CLOSED); expect(canonical[SUN]).toEqual(open(r('10:00', '22:00')))
    expect(days(parseOpeningHours('Daily 10:00–20:00'))).toEqual(Array(7).fill(open(r('10:00', '20:00'))))
  })
})
