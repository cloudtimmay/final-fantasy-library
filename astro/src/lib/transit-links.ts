// "🚆 Plan train": links to search the leg's trains at the right time (Asia/Tokyo).
//
// - Google Maps, the older maps URL (undocumented, kept next to today's link, which takes no time):
//   https://maps.google.com/maps?saddr=<from>&daddr=<to>&dirflg=r&ttype=dep|arr&date=MM/DD/YY&time=7:03am
// - Yahoo! 乗換案内 (the format its search result page uses; the norikae-mcp project builds the
//   same link):
//   https://transit.yahoo.co.jp/search/result?from=<station>&to=<station>&y=YYYY&m=MM&d=DD&hh=H&m1=<tens>&m2=<ones>&type=1|4
//   type: 1 = departure, 4 = arrival (3 = first train, 2 = last train, 5 = unspecified).
//   Station names: Japanese when known (JA_STATIONS), else the English name as written.

import { addDays } from './trip-dates'

export type TransitWhen ={ date: string; minutes: number; type: 'depart' | 'arrive' } // date YYYY-MM-DD, minutes 0–1439, Tokyo time
export type TransitPlace = { name: string; lat: number | null; lng: number | null }

// Common stations and airports on these trips, English → Japanese (Yahoo's own names).
export const JA_STATIONS: Record<string, string> = {
  'akihabara': '秋葉原', 'tokyo': '東京', 'shinjuku': '新宿', 'shibuya': '渋谷', 'ikebukuro': '池袋', 'ueno': '上野',
  'nakano': '中野', 'harajuku': '原宿', 'shinagawa': '品川', 'yokohama': '横浜', 'shizuoka': '静岡', 'higashi-shizuoka': '東静岡',
  'hamamatsucho': '浜松町', 'nippori': '日暮里', 'keisei ueno': '京成上野', 'odawara': '小田原', 'kyoto': '京都', 'osaka': '大阪',
  'shin-osaka': '新大阪', 'narita airport': '成田空港', 'narita airport terminal 1': '成田空港', 'narita airport terminal 2': '空港第２ビル',
  'narita airport terminal 2·3': '空港第２ビル', 'haneda airport': '羽田空港', 'haneda airport terminal 1': '羽田空港第１ターミナル',
  'haneda airport terminal 2': '羽田空港第２ターミナル', 'haneda airport terminal 3': '羽田空港第３ターミナル',
}
export function japaneseStation(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+station$/, '').replace(/\s+/g, ' ')
  return JA_STATIONS[key] || name.trim()
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// Always a DEPARTURE time: Google ignores the legacy URL's arrival type (ttype=arr) and opens
// "Depart at" the arrive-by time — so the time to search from is worked out first
// (googleMapsDeparture).
export function googleMapsTimedUrl(from: TransitPlace, to: TransitPlace, when: { date: string; minutes: number }): string {
  const place = (p: TransitPlace) => (p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : p.name)
  const [y, m, d] = when.date.split('-')
  const h = Math.floor(when.minutes / 60), min = when.minutes % 60
  const time = `${h % 12 === 0 ? 12 : h % 12}:${pad2(min)}${h < 12 ? 'am' : 'pm'}`
  const q = new URLSearchParams({
    saddr: place(from), daddr: place(to), dirflg: 'r', ttype: 'dep',
    date: `${m}/${d}/${y.slice(2)}`, time,
  })
  return `https://maps.google.com/maps?${q.toString()}`
}

// Time to spare before an arrive-by time when searching departures for it.
export const GOOGLE_ARRIVE_BUFFER_MIN = 10

// The departure Google Maps searches from, for the leg's search time `when` (legSearchTime):
// - a planned train: its first departure less the walk to the station (`train.departure` in
//   minutes on `train.date`, past midnight moving to the next date);
// - arrive by: that time less the leg's estimated travel time less GOOGLE_ARRIVE_BUFFER_MIN;
// - depart at: that time.
export type GoogleDeparture = { date: string; minutes: number; reason: 'train' | 'arrive' | 'depart'; trainDeparture?: number; walkToStationMin?: number }
export function googleMapsDeparture(
  when: TransitWhen,
  leg: { travelMin?: number | null; train?: { date: string; departure: number; walkToStationMin: number | null } | null },
): GoogleDeparture {
  const at = (date: string, minutes: number) => {
    const shift = Math.floor(minutes / 1440)
    return { date: shift ? addDays(date, shift) : date, minutes: ((minutes % 1440) + 1440) % 1440 }
  }
  if (leg.train) {
    const walk = leg.train.walkToStationMin ?? 0
    return { ...at(leg.train.date, leg.train.departure - walk), reason: 'train', trainDeparture: leg.train.departure % 1440, walkToStationMin: walk }
  }
  if (when.type === 'arrive') return { ...at(when.date, when.minutes - (leg.travelMin ?? 0) - GOOGLE_ARRIVE_BUFFER_MIN), reason: 'arrive' }
  return { date: when.date, minutes: when.minutes, reason: 'depart' }
}

const clock = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
// For the panel: "Google Maps opens with departures from 17:35 (to arrive by 18:30)".
export function googleMapsDepartureText(dep: GoogleDeparture, when: TransitWhen): string {
  const base = `Google Maps opens with departures from ${clock(dep.minutes)}`
  if (dep.reason === 'train') return `${base} (for the ${clock(dep.trainDeparture!)} train${dep.walkToStationMin ? `, ${dep.walkToStationMin} min walk to the station` : ''})`
  if (dep.reason === 'arrive') return `${base} (to arrive by ${clock(when.minutes)})`
  return base
}

export function yahooTransitUrl(fromStation: string, toStation: string, when: TransitWhen): string {
  const [y, m, d] = when.date.split('-')
  const h = Math.floor(when.minutes / 60), min = when.minutes % 60
  const q = new URLSearchParams({
    from: japaneseStation(fromStation), to: japaneseStation(toStation),
    y, m, d, hh: String(h), m1: String(Math.floor(min / 10)), m2: String(min % 10),
    type: when.type === 'arrive' ? '4' : '1',
  })
  return `https://transit.yahoo.co.jp/search/result?${q.toString()}`
}

// "Arriving by 07:30, Sat 5 Dec" / "Departing 06:32, …" — for the panel.
export function transitWhenText(when: TransitWhen): string {
  const t = `${pad2(Math.floor(when.minutes / 60))}:${pad2(when.minutes % 60)}`
  return `${when.type === 'arrive' ? 'Arriving by' : 'Departing'} ${t} on ${when.date}`
}
