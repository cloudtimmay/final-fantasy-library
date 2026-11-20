// "📷 Photos on Google Maps": a link that opens a shop in Google Maps in a new tab, where its
// photos can be browsed. Only a link — no image is ever fetched from, scraped from or stored
// from Google.
//
//   coordinates (and a name) -> a search for the name, centred on the coordinates
//                               (https://www.google.com/maps/search/<name>/@<lat>,<lng>,17z), so
//                               Maps opens that shop's own page rather than a dropped pin
//   coordinates, no name     -> the coordinates
//   no coordinates           -> the address: a Maps link pasted as the address as it is, else a
//                               search for "<name>, <address>"
//   nothing but the name     -> a search for "<name>, <area>, Japan"
export type MapsPlace = {
  name?: string | null
  lat?: number | null
  lng?: number | null
  address?: string | null
  area?: string | null
}

const SEARCH = 'https://www.google.com/maps/search/'
const validCoords = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180

// "🗺️ Open in Maps" for a place: a search for its name and address when it has an address (Google
// Maps opens the place itself — coordinates alone only drop a pin, and a pin from a map's view
// centre can be off), else its coordinates, else a Maps link pasted as the address, else a search
// for the name and area.
//   https://www.google.com/maps/search/?api=1&query=<name, address>
export function openInMapsUrl(p: MapsPlace): string {
  const name = String(p.name || '').trim()
  const address = String(p.address || '').trim()
  const addressIsUrl = /^https?:\/\//i.test(address)
  if (address && !addressIsUrl) return `${SEARCH}?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(', '))}`
  if (validCoords(p.lat, p.lng)) return `${SEARCH}?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`
  if (addressIsUrl) return address
  return `${SEARCH}?api=1&query=${encodeURIComponent([name, String(p.area || '').trim(), 'Japan'].filter(Boolean).join(', '))}`
}

// "🧭 Directions": Google Maps public transport directions to the place from where you are — no
// origin, so Maps uses your current location. The destination as "🗺️ Open in Maps" finds the place:
// its name and address when it has an address, else its coordinates, else its name and area.
//   https://www.google.com/maps/dir/?api=1&destination=<…>&travelmode=transit
export function directionsUrl(p: MapsPlace): string {
  const name = String(p.name || '').trim()
  const address = String(p.address || '').trim()
  const dest = address && !/^https?:\/\//i.test(address) ? [name, address].filter(Boolean).join(', ')
    : validCoords(p.lat, p.lng) ? `${p.lat},${p.lng}`
    : [name, String(p.area || '').trim(), 'Japan'].filter(Boolean).join(', ')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=transit`
}

export function googleMapsPlaceUrl(p: MapsPlace): string {
  const name = String(p.name || '').trim()
  const address = String(p.address || '').trim()
  if (validCoords(p.lat, p.lng)) {
    return name
      ? `${SEARCH}${encodeURIComponent(name)}/@${p.lat},${p.lng},17z`
      : `${SEARCH}?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`
  }
  if (/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(address)) return address
  const query = address ? [name, address] : [name, String(p.area || '').trim(), 'Japan']
  return `${SEARCH}?api=1&query=${encodeURIComponent(query.filter(Boolean).join(', '))}`
}
