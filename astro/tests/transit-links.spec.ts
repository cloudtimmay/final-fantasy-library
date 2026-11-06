import { test, expect } from './fixtures'
import { googleMapsTimedUrl, yahooTransitUrl, japaneseStation, transitWhenText } from '../src/lib/transit-links'
import { legSearchTime, computeDayTimes } from '../src/lib/itinerary-plan'

// "🚆 Plan train": links that search the leg's trains at its date and time (Asia/Tokyo).
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }
const query = (url: string) => Object.fromEntries(new URL(url).searchParams)

test.describe('train search links (lib/transit-links.ts)', () => {
  test('Google Maps (with time): the older maps URL — transit, depart-at or arrive-by, MM/DD/YY, 12-hour time', () => {
    const from = { name: 'Hotel', lat: 35.698, lng: 139.771 }, to = { name: 'Shizuoka Hobby Square', lat: 34.9718, lng: 138.3889 }
    const arrive = googleMapsTimedUrl(from, to, { date: '2026-12-05', minutes: t('09:00'), type: 'arrive' })
    expect(arrive.startsWith('https://maps.google.com/maps?')).toBe(true)
    expect(query(arrive)).toEqual({ saddr: '35.698,139.771', daddr: '34.9718,138.3889', dirflg: 'r', ttype: 'arr', date: '12/05/26', time: '9:00am' })
    const depart = googleMapsTimedUrl(from, { name: 'Narita Airport', lat: null, lng: null }, { date: '2026-12-06', minutes: t('18:15'), type: 'depart' })
    expect(query(depart)).toMatchObject({ daddr: 'Narita Airport', ttype: 'dep', date: '12/06/26', time: '6:15pm' })
    expect(query(googleMapsTimedUrl(from, to, { date: '2027-02-21', minutes: t('00:05'), type: 'depart' })).time).toBe('12:05am')
    expect(query(googleMapsTimedUrl(from, to, { date: '2027-02-21', minutes: t('12:40'), type: 'depart' })).time).toBe('12:40pm')
  })

  test('Yahoo! 乗換案内: from/to (Japanese when known), y, m, d, hh, m1/m2 (the minute\'s digits), type 1 = depart, 4 = arrive', () => {
    const depart = yahooTransitUrl('Akihabara', 'Shizuoka', { date: '2026-12-05', minutes: t('06:47'), type: 'depart' })
    expect(depart.startsWith('https://transit.yahoo.co.jp/search/result?')).toBe(true)
    expect(query(depart)).toEqual({ from: '秋葉原', to: '静岡', y: '2026', m: '12', d: '05', hh: '6', m1: '4', m2: '7', type: '1' })
    const arrive = yahooTransitUrl('Shinjuku', 'Narita Airport Terminal 1', { date: '2026-12-06', minutes: t('20:00'), type: 'arrive' })
    expect(query(arrive)).toMatchObject({ from: '新宿', to: '成田空港', hh: '20', m1: '0', m2: '0', type: '4' })
    // Unknown: the English name as written.
    expect(japaneseStation('Some Small Station')).toBe('Some Small Station')
    expect(japaneseStation('Tokyo Station')).toBe('東京')
    expect(transitWhenText({ date: '2026-12-05', minutes: t('09:00'), type: 'arrive' })).toBe('Arriving by 09:00 on 2026-12-05')
  })

  test('the search time: arrive by the next fixed time (less arrive-early) or check-in; else depart when the stop before is left', () => {
    const day: any = {
      day: '2026-12-05', startTime: '06:00',
      stops: [
        { name: 'Hotel Breakfast', lat: 35.698, lng: 139.771, dur: 30, travelMin: 0, travelFrom: '__base__' },
        { name: 'Shop', lat: 35.7, lng: 139.77, dur: 45 },
        { name: 'Temple', lat: 35.6526, lng: 139.7279, dur: 60, fixedTime: '19:00', arriveEarly: 30 },
      ],
    }
    const { sched, baseStart } = computeDayTimes(day, BASE, new Map())
    expect(legSearchTime(day, sched, 0, 'stop', { baseStart })).toEqual({ date: '2026-12-05', minutes: t('06:00'), type: 'depart' }) // the day's start
    expect(legSearchTime(day, sched, 1, 'stop', { baseStart })).toEqual({ date: '2026-12-05', minutes: sched.stops[0].leaveBy, type: 'depart' })
    expect(legSearchTime(day, sched, 2, 'stop', { baseStart })).toEqual({ date: '2026-12-05', minutes: t('18:30'), type: 'arrive' }) // 19:00 − 30
    expect(legSearchTime(day, sched, 3, 'airport', { baseStart, checkInBy: t('20:00') })).toEqual({ date: '2026-12-05', minutes: t('20:00'), type: 'arrive' })
    expect(legSearchTime(day, sched, 3, 'return', { baseStart })).toEqual({ date: '2026-12-05', minutes: sched.stops[2].end, type: 'depart' })
    // Past midnight: the next date.
    const late: any = { day: '2026-12-05', startTime: '23:30', stops: [{ name: 'Late', lat: 35.7, lng: 139.77, dur: 60, travelMin: 0, travelFrom: '__base__' }] }
    const l = computeDayTimes(late, BASE, new Map())
    expect(legSearchTime(late, l.sched, 1, 'return', { baseStart: l.baseStart })).toEqual({ date: '2026-12-06', minutes: t('00:30'), type: 'depart' })
  })
})
