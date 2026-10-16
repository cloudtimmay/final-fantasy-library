// Pure, dependency-free helpers for the "Check day" itinerary review feature
// (api/itinerary-review.ts). Kept separate from that endpoint file (rather than exported
// from it directly) so they can be imported by tests without pulling in Astro's
// APIRoute/import.meta.env machinery.

export type ReviewStopInput = {
  name: string
  plannedTime: number // minutes since midnight
  durationMin: number
  lat: number | null
  lng: number | null
}

export type StopTransition = {
  distanceKm: number | null // null if either stop is missing coordinates
  gapMin: number // minutes between the end of the previous stop and the start of this one; can be negative if they overlap
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// For every stop after the first, computes the straight-line distance from the previous
// stop (haversine, null if either is missing coordinates) and the gap in minutes between
// the previous stop ending and this one starting — so the model is handed the arithmetic
// instead of being asked to do it itself. Index 0 always gets null (nothing precedes it).
export function computeTransitions(stops: ReviewStopInput[]): (StopTransition | null)[] {
  return stops.map((s, i) => {
    if (i === 0) return null
    const prev = stops[i - 1]
    const distanceKm =
      prev.lat != null && prev.lng != null && s.lat != null && s.lng != null
        ? haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: s.lat, lng: s.lng })
        : null
    const gapMin = s.plannedTime - (prev.plannedTime + prev.durationMin)
    return { distanceKm, gapMin }
  })
}

// Sums JPY amounts like "¥260" or "¥1,200" found in free text (shop notes) — used to
// estimate a day's total train fare from notes that mention real fares. Ignores anything
// that doesn't match; never throws.
export function extractJpyTotal(texts: Array<string | null | undefined>): number {
  let total = 0
  for (const text of texts) {
    if (!text) continue
    const matches = text.match(/¥\s?[\d,]+/g) || []
    for (const m of matches) {
      const n = Number(m.replace(/[¥,\s]/g, ''))
      if (isFinite(n)) total += n
    }
  }
  return total
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
