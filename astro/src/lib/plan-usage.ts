// Which places are already in a trip's plan, and on which days — the itinerary's shop pickers
// ("✓ Animate · 2. des") and Shop Notes' "📅 Planned: 2 Dec" badge and filter read it the same
// way, so they always agree. A place counts when a stop on one of the trip's days is linked to
// it (stop.shopId); a stop written by hand doesn't. Pure.
import { isIsoDate } from './trip-dates'
import { nameMatch } from './stop-linking'

export type PlanUsageDay = { day: string; stops?: ({ shopId?: string | null } | null)[] | null }
export type PlannedDays = Record<string, string[]> // shopId → its days ("YYYY-MM-DD"), in order

export function plannedDaysByShop(days: PlanUsageDay[]): PlannedDays {
  const byShop: Record<string, Set<string>> = {}
  for (const d of days) {
    if (!isIsoDate(d.day)) continue
    for (const s of d.stops || []) {
      const id = s?.shopId
      if (typeof id === 'string' && id) (byShop[id] ||= new Set()).add(d.day)
    }
  }
  return Object.fromEntries(Object.entries(byShop).map(([id, set]) => [id, [...set].sort()]))
}

// The trip's days from its saved plan (the itineraryState document's `data`: { v: 2, days: {
// "YYYY-MM-DD": { stops } } }) — only those from `range.first` to `range.last` (the trip's days,
// as the itinerary shows them; other dates there are "Not scheduled"). Unreadable: none.
export function savedPlanDays(data: string | null | undefined, range: { first?: string | null; last?: string | null } = {}): PlanUsageDay[] {
  if (!data) return []
  let parsed: any
  try { parsed = JSON.parse(data) } catch { return [] }
  if (!parsed || parsed.v !== 2 || !parsed.days || typeof parsed.days !== 'object') return []
  const first = isIsoDate(range.first) ? range.first : null
  const last = isIsoDate(range.last) ? range.last : null
  return Object.entries(parsed.days as Record<string, any>)
    .filter(([day]) => isIsoDate(day) && (!first || day >= first) && (!last || day <= last))
    .map(([day, d]) => ({ day, stops: Array.isArray(d?.stops) ? d.stops : [] }))
}

const MONTHS_NB = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "2. des, 5. des" (the itinerary's own style) or "2 Dec, 5 Dec" (Shop Notes).
export function plannedDaysText(days: string[], style: 'nb' | 'en'): string {
  return days.filter(isIsoDate).map((iso) => {
    const m = Number(iso.slice(5, 7)) - 1, d = Number(iso.slice(8, 10))
    return style === 'nb' ? `${d}. ${MONTHS_NB[m]}` : `${d} ${MONTHS_EN[m]}`
  }).join(', ')
}

// A picker's label: "✓ Animate · 2. des" when planned, else just the name.
export const PLANNED_MARK = '✓ '
export function plannedPickerName(name: string, days: string[] | undefined): string {
  return days && days.length ? `${PLANNED_MARK}${name} · ${plannedDaysText(days, 'nb')}` : name
}

// The saved shop a search result is (the add-stop "🔍 Search place"): the same name, or a close
// name within ~150 m. null when none.
export function matchingShop<S extends { _id: string; shopName?: string | null; latitude?: number | null; longitude?: number | null }>(
  place: { name: string; lat: number; lng: number }, shops: S[],
): S | null {
  let best: S | null = null
  for (const s of shops) {
    const m = nameMatch(place.name, s.shopName)
    if (!m) continue
    if (m.kind === 'exact') return s
    if (typeof s.latitude === 'number' && typeof s.longitude === 'number') {
      const dy = (s.latitude - place.lat) * 111_000, dx = (s.longitude - place.lng) * 111_000 * Math.cos((place.lat * Math.PI) / 180)
      if (Math.hypot(dx, dy) <= 150) best = best || s
    }
  }
  return best
}
