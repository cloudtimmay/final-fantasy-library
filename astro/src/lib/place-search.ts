// Place search with OpenStreetMap Nominatim (no Google Places): by name or address, biased to
// Japan. The endpoint (src/pages/api/place-search.ts) calls searchPlaces, which keeps to
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/): an
// identifying User-Agent, at most one request a second (queued here), results cached for a while,
// and "© OpenStreetMap contributors" shown with them. The fetch is passed in, so tests never call
// Nominatim.
import { hoursUnderstood } from './opening-hours'

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
// Identifies this app (no personal contact details are sent).
export const PLACE_SEARCH_USER_AGENT = 'FinalFantasyLibrary-TripPlanner/1.0 (private trip planner; low volume)'
const MIN_INTERVAL_MS = 1000
const CACHE_MS = 10 * 60 * 1000
const CACHE_MAX = 200
const MAX_RESULTS = 6

export type PlaceResult = {
  name: string
  address: string
  lat: number
  lng: number
  kind: string // what OSM calls it, readable: "park", "station", "shop", "temple" …
  placeType: 'shop' | 'restaurant' | 'sight' | 'hotel' | 'area' | 'other' // our place type (lib/place-types.ts)
  area: string | null // the neighbourhood / ward, a guess for the area field
  openingHours: string | null // only when our parser understands it (converted from OSM's format)
  osmId: string
}

export function nominatimUrl(query: string): string {
  const q = new URLSearchParams({
    q: query.trim().slice(0, 200), format: 'jsonv2', countrycodes: 'jp', addressdetails: '1', extratags: '1', namedetails: '1',
    limit: String(MAX_RESULTS), 'accept-language': 'en',
  })
  return `${NOMINATIM_URL}?${q.toString()}`
}

// OSM's category/type → our place type and a readable kind.
function classify(category: string, type: string): { placeType: PlaceResult['placeType']; kind: string } {
  const t = type.replace(/_/g, ' ')
  if (category === 'shop') return { placeType: 'shop', kind: type === 'yes' ? 'shop' : `${t} shop` }
  if (category === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'food_court', 'bar', 'pub', 'izakaya'].includes(type)) return { placeType: 'restaurant', kind: t }
  if (category === 'amenity' && type === 'place_of_worship') return { placeType: 'sight', kind: 'temple / shrine' }
  if (category === 'tourism' && ['hotel', 'hostel', 'guest_house', 'motel', 'apartment'].includes(type)) return { placeType: 'hotel', kind: t }
  if (category === 'tourism' || category === 'historic' || (category === 'leisure' && ['park', 'garden', 'nature_reserve'].includes(type))) return { placeType: 'sight', kind: t }
  if (category === 'place' && ['neighbourhood', 'suburb', 'quarter', 'city_block', 'borough', 'city', 'town', 'village'].includes(type)) return { placeType: 'area', kind: t }
  if (category === 'railway' || (category === 'public_transport' && type === 'station')) return { placeType: 'other', kind: 'station' }
  return { placeType: 'other', kind: t || category }
}

// OSM's opening_hours, where it's simple, into the form our parser reads; null otherwise (or when
// our parser still doesn't understand it).
export function osmHoursToText(osm: string | null | undefined): string | null {
  if (!osm || typeof osm !== 'string') return null
  const s = osm.trim()
  let text: string | null = null
  if (s === '24/7') text = 'Open 24 hours'
  else {
    const m = /^(?:Mo-Su\s+)?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(s)
    if (m) text = `${m[1].padStart(5, '0')}–${m[2].padStart(5, '0')}`
  }
  return text && hoursUnderstood(text) ? text : null
}

export function parseNominatim(raw: unknown): PlaceResult[] {
  if (!Array.isArray(raw)) return []
  const out: PlaceResult[] = []
  for (const r of raw as any[]) {
    const lat = Number(r?.lat), lng = Number(r?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const a = r.address || {}
    const name = String(r.namedetails?.['name:en'] || r.name || r.namedetails?.name || String(r.display_name || '').split(',')[0] || '').trim()
    if (!name) continue
    const { placeType, kind } = classify(String(r.category || r.class || ''), String(r.type || ''))
    const area = a.neighbourhood || a.quarter || a.suburb || a.city_district || null
    out.push({
      name: name.slice(0, 120),
      address: String(r.display_name || '').slice(0, 300),
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
      kind, placeType,
      area: area ? String(area).slice(0, 60) : null,
      openingHours: osmHoursToText(r.extratags?.opening_hours),
      osmId: `${r.osm_type || ''}${r.osm_id || ''}`,
    })
  }
  return out.slice(0, MAX_RESULTS)
}

// One search, through the cache and the one-a-second queue.
type Deps = { fetch: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> }
const cache = new Map<string, { at: number; results: PlaceResult[] }>()
let queue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0
export function resetPlaceSearchForTests(): void { cache.clear(); queue = Promise.resolve(); lastRequestAt = 0 }

export async function searchPlaces(query: string, deps: Deps): Promise<PlaceResult[]> {
  const now = deps.now || Date.now
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const key = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (key.length < 2) return []
  const hit = cache.get(key)
  if (hit && now() - hit.at < CACHE_MS) return hit.results
  const run = async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = now()
    const res = await deps.fetch(nominatimUrl(query), { headers: { 'User-Agent': PLACE_SEARCH_USER_AGENT, Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Nominatim ${res.status}`)
    const results = parseNominatim(await res.json())
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(key, { at: now(), results })
    return results
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}
