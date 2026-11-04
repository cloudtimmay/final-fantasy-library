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
