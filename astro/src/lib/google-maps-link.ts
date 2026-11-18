// A Google Maps link pasted into a place search ("Search place", "Add place", "📍 Find location"):
// the coordinates and the place name read from the URL itself — no Google API and no Google page
// is ever fetched. A share link (maps.app.goo.gl/…, goo.gl/maps/…) is a redirect: the server
// follows it (`resolveMapsLink`) only to learn the URL it points to, reading the Location header
// and never a page body. Pure apart from the injected fetch.
import type { PlaceResult } from './place-search'

const isGoogleHost = (h: string) => /(^|\.)google\.[a-z.]{2,6}$/i.test(h)
const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co']

function urlOf(text: string): URL | null {
  const s = text.trim()
  if (!/^https?:\/\//i.test(s) || /\s/.test(s)) return null
  try { return new URL(s) } catch { return null }
}

// A share link that has to be followed to get the real URL.
export function isShortMapsLink(text: string): boolean {
  const u = urlOf(text)
  if (!u) return false
  const h = u.hostname.toLowerCase()
  return h === 'maps.app.goo.gl' || (h === 'goo.gl' && u.pathname.startsWith('/maps')) || (h === 'g.co' && u.pathname.startsWith('/kgs'))
}

// Any Google Maps link: google.<tld>/maps…, maps.google.<tld>/…, or a share link.
export function isGoogleMapsUrl(text: string): boolean {
  const u = urlOf(text)
  if (!u) return false
  const h = u.hostname.toLowerCase()
  if (isShortMapsLink(text)) return true
  return (isGoogleHost(h) && (h.startsWith('maps.') || u.pathname.startsWith('/maps')))
}

const coordPair = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null
const LATLNG = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

// Percent-decoding that never throws (a stray "%" in a pasted link): what can't be decoded stays.
const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s.replace(/%21/gi, '!').replace(/%2C/gi, ',').replace(/%40/g, '@') } }

// The place's own pin in a Google Maps URL — never the map's view centre (@lat,lng, which is
// only where the map was looking). In the place's data block: "!3d<lat>!4d<lng>" (the one after
// the place's id "!1s0x…", else the last); an embed/"pb=" link: "!2d<lng>!3d<lat>".
export function placePin(full: string): { lat: number; lng: number } | null {
  const pins = [...full.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)]
  if (pins.length) {
    const placeId = full.lastIndexOf('!1s0x')
    const afterId = placeId >= 0 ? pins.find((m) => (m.index ?? 0) > placeId) : undefined
    const m = afterId || pins[pins.length - 1]
    return coordPair(Number(m[1]), Number(m[2]))
  }
  const embed = [...full.matchAll(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/g)]
  if (embed.length) { const m = embed[embed.length - 1]; return coordPair(Number(m[2]), Number(m[1])) }
  return null
}

// The place in a (full) Google Maps URL: its pin (placePin — the place itself, so first), else
// q=/query=/ll= coordinates, else /search/<lat>,<lng>, and only then the map's centre
// (@lat,lng,zoom); its name from /maps/place/<name>/ or a q=/query= that isn't coordinates. null
// without coordinates.
export function parseGoogleMapsUrl(text: string): { name: string; lat: number; lng: number } | null {
  const u = urlOf(text)
  if (!u || !isGoogleHost(u.hostname.toLowerCase())) return null
  const full = safeDecode(u.pathname + u.search + u.hash)
  let at: { lat: number; lng: number } | null = placePin(full)
  let name = ''
  for (const key of ['q', 'query', 'll', 'destination', 'daddr']) {
    const v = u.searchParams.get(key)
    if (!v) continue
    const m = LATLNG.exec(v)
    if (m) at = at || coordPair(Number(m[1]), Number(m[2]))
    else if (!name && key !== 'll') name = v.trim()
  }
  // /maps/search/35.7,139.77 or /maps/place/35.7,139.77
  const pathCoords = /\/maps\/(?:search|place)\/(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/.exec(full)
  if (!at && pathCoords) at = coordPair(Number(pathCoords[1]), Number(pathCoords[2]))
  const centre = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(full)
  if (!at && centre) at = coordPair(Number(centre[1]), Number(centre[2]))
  const placeName = /\/maps\/place\/([^/@]+)/.exec(u.pathname)
  if (placeName) {
    const n = safeDecode(placeName[1].replace(/\+/g, ' ')).trim()
    if (n && !LATLNG.test(n)) name = n
  }
  if (!at) return null
  return { name: name.replace(/\+/g, ' ').trim(), ...at }
}

// A share link → the URL it redirects to, following at most 3 redirects and only to Google
// hosts. Only the Location header is read (redirect: 'manual'), never a body. A consent page in
// between gives its continue= URL. null when it doesn't lead to a Google Maps URL.
export async function resolveMapsLink(text: string, fetchFn: typeof fetch): Promise<string | null> {
  let url = text.trim()
  for (let hop = 0; hop < 3; hop++) {
    if (!isShortMapsLink(url)) break
    const res = await fetchFn(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'FinalFantasyLibrary-TripPlanner/1.0' } })
    try { await res.body?.cancel() } catch {}
    const location = res.headers.get('location')
    if (!location || res.status < 300 || res.status >= 400) return null
    const next = new URL(location, url)
    const host = next.hostname.toLowerCase()
    if (host === 'consent.google.com') {
      const cont = next.searchParams.get('continue')
      if (!cont) return null
      url = cont
      continue
    }
    if (!isGoogleHost(host) && !SHORT_HOSTS.includes(host)) return null
    url = next.toString()
  }
  return isGoogleMapsUrl(url) && !isShortMapsLink(url) ? url : null
}

// The link's place as a search result to confirm.
export function mapsLinkPlace(p: { name: string; lat: number; lng: number }): PlaceResult {
  return {
    name: p.name || 'Place from Google Maps link',
    address: '',
    lat: p.lat, lng: p.lng,
    kind: 'Google Maps link',
    placeType: 'other',
    area: null,
    openingHours: null,
    osmId: `gmaps:${p.lat.toFixed(6)},${p.lng.toFixed(6)}`,
  }
}
