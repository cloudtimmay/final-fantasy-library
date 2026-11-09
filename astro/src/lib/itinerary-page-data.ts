// Everything /itinerary (the timeline) and /itinerary-list load on the server: the default plan, the
// trip (?trip=<id> or the default one), its days in Tokyo and their labels, the flight home,
// the shops and the saved plan. One function, so both pages show the same days for the same trip.
import { sanity } from './sanity'
import { formatDayLabel, dateRange, isIsoDate, shortDateRange } from './trip-dates'
import { fetchTripsForSpending, pickDefaultTrip } from './spending'
import { parseFlightHome, latestEndForFlight, flightLine, formatClock } from './itinerary-review-helpers'
import { foundItems, foundPricesQuery, foundPurchasesQuery, type FoundItem, type FoundPriceDoc, type FoundPurchaseDoc } from './shop-found'
import { planDocIdFor, ownsOriginalPlan, planTrips, arrivalFor, shopsTripFirst, withFlightDays, type PlanTrip } from './trip-plans'

export const BASE = { name: 'Base (overnatting)', lat: 35.697999, lng: 139.770830 }

export const AREA_MIN_FROM_AKIB: Record<string, number> = {
  'Akihabara': 0, 'Shinjuku': 15, 'Ikebukuro': 15, 'Shibuya': 20,
  'Harajuku': 22, 'Tokyo Station': 5, 'Nakano': 25, 'Yokohama': 45, 'Shinagawa': 12,
}

// The default plan, one entry per calendar day ("YYYY-MM-DD"). No weekday is ever written
// here: labels like "1. des (tir)" are computed by lib/trip-dates.ts (formatDayLabel), the
// same function /api/itinerary-review uses. (They used to be hand-written, and carried the
// weekdays of December 2025 — 1 December 2026 is a Tuesday, not a Monday.)
export const PLAN = [
  {
    day: '2026-12-01', area: 'Akihabara', note: 'Ankomstdag — full Akihabara-dag. Ta kveldsbutikkene nederst hvis du orker, ellers flytt dem (⋯) til en annen kveld.',
    stops: [
      { name: 'Super Potato', hours: '11:00–20:00 · bruk god tid', tag: 'MUST', slot: 'dagtid', lat: 35.699358, lng: 139.770702 },
      { name: 'Animate', hours: '10:00–21:00', tag: 'MUST', slot: 'dagtid', lat: 35.700494, lng: 139.771743 },
      { name: '🍜 Tsujita Akihabara', hours: 'Lunsj · tsukemen', tag: 'mat', slot: '', lat: 35.699031, lng: 139.770140 },
      { name: 'AKIHABARA KOTOBUKIYA', hours: '11:00–20:00', tag: '', slot: 'dagtid', lat: 35.699229, lng: 139.770461 },
      { name: 'Liberty Akihabara 5', hours: '11:00–20:30', tag: '', slot: 'dagtid', lat: 35.701461, lng: 139.771787 },
      { name: 'Liberty Hobby Shop', hours: '11:00–20:30', tag: '', slot: 'dagtid', lat: 35.702324, lng: 139.771887 },
      { name: 'Retro Game Camp', hours: '11:00–20:00', tag: '', slot: 'dagtid', lat: 35.701199, lng: 139.771271 },
      { name: 'Yellow Submarine RPG Shop', hours: '12:00–20:00', tag: '', slot: 'dagtid', lat: 35.702083, lng: 139.771894 },
      { name: 'Kamikaze Style', hours: '11:00–20:00', tag: '', slot: 'dagtid', lat: 35.702057, lng: 139.769845 },
      { name: '3COINS', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.698373, lng: 139.772696 },
      { name: '🍣 Final Fantasy Eorzea Cafe', hours: 'Middag · FF-tema', tag: 'mat', slot: '', lat: 35.697776, lng: 139.770364 },
      { name: 'Yodobashi Camera Akiba', hours: '09:30–22:00', tag: '', slot: 'kveld', lat: 35.698917, lng: 139.774798 },
      { name: 'BicCamera AKIBA', hours: '10:00–22:00', tag: '', slot: 'kveld', lat: 35.699830, lng: 139.771788 },
      { name: 'BOOKOFF Akihabara Ekimae', hours: '10:00–22:00', tag: '', slot: 'kveld', lat: 35.697734, lng: 139.773475 },
      { name: 'Tokyo Hobby Center', hours: '11:00–22:00', tag: '', slot: 'kveld', lat: 35.703070, lng: 139.772150 },
    ],
  },
  {
    day: '2026-12-02', area: 'Shinjuku',
    stops: [
      { name: 'ARTNIA (Square Enix)', hours: '11:00–21:00', tag: 'MUST', slot: 'dagtid', lat: 35.696102, lng: 139.709009 },
      { name: 'SURUGA-YA Marui Annex', hours: '11:00–21:00', tag: 'MUST', slot: 'dagtid', lat: 35.690151, lng: 139.705842 },
      { name: '🍜 Ramen Hayashida', hours: 'Lunsj · kontant', tag: 'mat', slot: '', lat: 35.690729, lng: 139.703751 },
      { name: 'ONE PIECE Base Shop', hours: '11:00–20:00', tag: '', slot: 'dagtid', lat: 35.690903, lng: 139.704070 },
      { name: 'Bic Camera Shinjuku West', hours: '10:00–20:30', tag: '', slot: 'dagtid', lat: 35.692513, lng: 139.698556 },
      { name: 'Hard Off Marui Men', hours: '11:00–20:00', tag: '', slot: 'dagtid', lat: 35.692699, lng: 139.706307 },
      { name: 'Yellow Submarine Shinjuku', hours: '12:00–20:00', tag: '', slot: 'dagtid', lat: 35.689356, lng: 139.697787 },
      { name: '🍣 Sushi Hatsume (omakase)', hours: 'Middag · bestill bord', tag: 'mat', slot: '', lat: 35.694050, lng: 139.698016 },
      { name: 'Yodobashi Shinjuku', hours: '09:30–22:00', tag: '', slot: 'kveld', lat: 35.689883, lng: 139.697953 },
      { name: 'BOOKOFF Shinjuku West', hours: '10:00–22:00', tag: '', slot: 'kveld', lat: 35.689568, lng: 139.698385 },
      { name: 'DAISO', hours: '10:00–22:00', tag: '', slot: 'kveld', lat: 35.691304, lng: 139.702974 },
      { name: 'TAITO Station GameWorld', hours: '10:00–01:00', tag: '', slot: 'kveld', lat: 35.689910, lng: 139.702255 },
      { name: 'Takadanobaba Mikado', hours: '10:00–23:30', tag: '', slot: 'kveld', lat: 35.712735, lng: 139.703455 },
    ],
  },
  {
    day: '2026-12-03', area: 'Ikebukuro',
    stops: [
      { name: 'animate Flagship Store', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.731144, lng: 139.715459 },
      { name: 'Gashapon Main Store', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.728499, lng: 139.719797 },
      { name: 'Donguri (Ghibli)', hours: '10:00–20:00', tag: '', slot: 'dagtid', lat: 35.728862, lng: 139.719377 },
      { name: '🍜 Gyumon (wagyu ramen)', hours: 'Lunsj · 4.8★', tag: 'mat', slot: '', lat: 35.733522, lng: 139.709866 },
      { name: 'Ikebukuro PARCO', hours: '11:00–21:00', tag: '', slot: 'dagtid', lat: 35.730857, lng: 139.712384 },
      { name: 'Mandarake Nayuta', hours: '12:00–20:00', tag: '', slot: 'dagtid', lat: 35.731606, lng: 139.712377 },
      { name: 'BOOKOFF Sunshine 60', hours: '10:00–22:00', tag: '', slot: 'kveld', lat: 35.729680, lng: 139.715769 },
    ],
  },
  {
    day: '2026-12-04', area: 'Shibuya + Harajuku',
    stops: [
      { name: 'Nintendo Tokyo (PARCO)', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.662116, lng: 139.698639 },
      { name: 'Jump Shop Shibuya Parco', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.661834, lng: 139.698776 },
      { name: 'Square Enix Garden', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.657255, lng: 139.701621 },
      { name: '🍣 Uobei (transportbånd-sushi)', hours: 'Lunsj · rett ved PARCO', tag: 'mat', slot: '', lat: 35.659435, lng: 139.697921 },
      { name: 'ONE PIECE Straw Hat Store', hours: '10:00–21:00', tag: '', slot: 'dagtid', lat: 35.659766, lng: 139.700826 },
      { name: 'ONE PIECE Mugiwara Harajuku', hours: '11:00–21:00', tag: 'Harajuku', slot: 'dagtid', lat: 35.668369, lng: 139.704914 },
      { name: 'MEGA Don Quijote', hours: 'Døgnåpent', tag: '', slot: 'kveld', lat: 35.660387, lng: 139.697817 },
    ],
  },
  {
    day: '2026-12-05', area: 'Tokyo Station + Shinagawa',
    stops: [
      { name: 'Ōimachi Station Market', hours: '09:00–14:30 (kun 5.–6.) · start her', tag: 'kun i dag/i morgen', slot: 'dagtid', lat: 35.606832, lng: 139.734280 },
      { name: 'Pokémon Store Tokyo Station', hours: '10:00–20:30', tag: '', slot: 'dagtid', lat: 35.682496, lng: 139.768683 },
      { name: 'Tomica Shop Character St.', hours: '10:00–20:30', tag: '', slot: 'dagtid', lat: 35.681627, lng: 139.768495 },
      { name: 'Harry Potter Mahou Dokoro', hours: '10:00–20:30', tag: '', slot: 'dagtid', lat: 35.681347, lng: 139.768360 },
      { name: '🍜 Soranoiro Nippon (ramen)', hours: 'Lunsj · Ramen Street', tag: 'mat', slot: '', lat: 35.680810, lng: 139.769230 },
      { name: 'Ghibli Donguri Tokyo Station', hours: '10:00–20:30', tag: '', slot: 'dagtid', lat: 35.681858, lng: 139.768669 },
    ],
  },
  {
    day: '2026-12-06', area: 'Nakano',
    stops: [
      { name: 'Nakano Broadway', hours: '10:00–20:00 · sett av god tid', tag: 'sett av tid', slot: 'dagtid', lat: 35.709248, lng: 139.665652 },
      { name: '🍜 Yang Guo Fu Mala Tang', hours: 'Lunsj · nær Broadway', tag: 'mat', slot: '', lat: 35.708064, lng: 139.665548 },
    ],
  },
  {
    day: '2026-12-07', area: 'Yokohama',
    stops: [
      { name: 'SURUGA-YA Marui City Yokohama', hours: '10:30–20:30', tag: '', slot: 'dagtid', lat: 35.464556, lng: 139.624649 },
      { name: 'BOOKOFF AEON Honmoku', hours: '09:00–21:00 · lengre unna', tag: '', slot: 'dagtid', lat: 35.417500, lng: 139.660800 },
    ],
  },
]

export async function loadItineraryPageData(url: URL) {
  // The shops and the trips are fetched at the same time; then the chosen trip's plan
  // (lib/trip-plans.ts: the original document for the December 2026 trip, its own for the others).
  const [shops, { trip, trips }] = await Promise.all([loadShops(), loadTrip(url)])
  const savedState = await loadSavedState(planDocIdFor(trip))
  return pageDataFrom(shops, savedState, trip, trips)
}

type PageTrip = PlanTrip & { label?: string; jpyToNokRate?: number; flightHomeTerminal?: string; travelers?: number | null }
const TRIP_FIELDS = `_id, label, jpyToNokRate, travelers, startDate, endDate, firstTokyoDay, lastTokyoDay, arrivalDate, arrivalTime, arrivalAirport, flightHomeDate, flightHomeTime, flightHomeAirport, flightHomeTerminal`

async function loadShops(): Promise<any[]> {
  try {
    return await sanity.fetch(`
      *[_type == "shopNote" && !(_id in path("drafts.**")) && defined(shopName)]{
        _id, shopName, area, placeType, openingHours, latitude, longitude, note, address, "tripIds": trips[]._ref,
        "photos": photos[defined(asset)]{ caption, "url": asset->url }
      } | order(area asc, shopName asc)
    `)
  } catch (e) { return [] }
}

// Saved plan (synced across devices). Null the first time.
async function loadSavedState(docId: string): Promise<string | null> {
  try {
    const doc = await sanity.fetch(`*[_id == $id][0]{ data }`, { id: docId })
    return doc && typeof doc.data === 'string' ? doc.data : null
  } catch (e) { return null }
}

// The trip: ?trip=<id>, else the same default /spending picks (the ongoing or next upcoming
// trip). The page remembers a trip picked in its switcher and comes back with ?trip= (TripSwitch).
// `trips`: every trip with days in Tokyo, for the switcher.
async function loadTrip(url: URL): Promise<{ trip: PageTrip | null; trips: PageTrip[] }> {
  try {
    // Empty Tokyo days come from the flight dates (withFlightDays).
    const all: PageTrip[] = (await sanity.fetch(`*[_type == "tripSettings" && !(_id in path("drafts.**"))] | order(_createdAt asc) { ${TRIP_FIELDS} }`)).map(withFlightDays)
    const requestedTripId = url.searchParams.get('trip')
    const forDefault = all.map((t) => ({ _id: t._id, label: t.label, startDate: t.startDate || undefined, endDate: t.endDate || undefined, childBudgets: [] }))
    const pickedId = all.some((t) => t._id === requestedTripId) ? requestedTripId : pickDefaultTrip(forDefault)?._id
    return { trip: all.find((t) => t._id === pickedId) || null, trips: planTrips(all) }
  } catch (e) { return { trip: null, trips: [] } }
}

function pageDataFrom(shopsIn: any[], savedState: string | null, trip: PageTrip | null, trips: PageTrip[] = []) {
  // The default December plan only for the trip that owns the original plan; another trip starts
  // empty. Its shops first in the pickers (shopNote.trips).
  const plan = ownsOriginalPlan(trip) ? PLAN.map((d) => ({ ...d, date: formatDayLabel(d.day) })) : []
  const shops = shopsTripFirst(shopsIn, trip?._id)

  // The days shown: the trip's days in Tokyo (Trip Settings → First/Last day in Tokyo) — not
  // its Start/End date, which are the travel dates (leaving home / getting home). Without Tokyo
  // days set, the plan's own dates are shown, with a hint to fill them in.
  const tripDays = dateRange(trip?.firstTokyoDay, trip?.lastTokyoDay)
  const usingTripDays = tripDays.length > 0
  const days = usingTripDays ? tripDays : plan.map((d) => d.day)
  const rangeLabel = days.length ? `${formatDayLabel(days[0])} – ${formatDayLabel(days[days.length - 1])}` : ''

  // Labels for every date the page can show: the days, the plan's own days, and any date in the
  // saved plan (a stop on a date outside the trip is listed under "Not scheduled" — never dropped).
  // The saved plan used to be an array, one entry per PLAN day in order; now { v: 2, days: { date } }.
  function savedDates(raw: string | null): string[] {
    try {
      const p = raw ? JSON.parse(raw) : null
      if (Array.isArray(p)) return plan.slice(0, p.length).map((d) => d.day)
      if (p && p.v === 2 && p.days && typeof p.days === 'object') return Object.keys(p.days).filter((k) => isIsoDate(k))
    } catch (e) {}
    return []
  }
  // The flight home (Trip Settings): shown on its day ("✈️ Flight 23:00 from Narita (T1)") and
  // sent with that day's "Check day". Its date defaults to the last day in Tokyo.
  const flightBase = parseFlightHome({ time: trip?.flightHomeTime, airport: trip?.flightHomeAirport, terminal: trip?.flightHomeTerminal })
  const flightDate = isIsoDate(trip?.flightHomeDate) ? trip!.flightHomeDate : trip?.lastTokyoDay
  const flight = flightBase && isIsoDate(flightDate)
    ? { ...flightBase, date: flightDate, line: flightLine(flightBase), latestEnd: formatClock(latestEndForFlight(flightBase)) }
    : null
  const labels: Record<string, string> = {}
  for (const d of [...days, ...plan.map((p) => p.day), ...savedDates(savedState)]) labels[d] = formatDayLabel(d)

  // The arrival in Japan: "✈️ Landing 07:55 at Haneda Airport" on its day, which then starts at
  // the landing + immigration + the trip to the base (unless a start time was chosen).
  const arrival = arrivalFor(trip)
  const startDefaults: Record<string, string> = arrival ? { [arrival.date]: arrival.start } : {}
  const tripChoices = trips.map((t) => ({ _id: t._id, label: t.label || 'Trip', range: shortDateRange(t.firstTokyoDay!, t.lastTokyoDay!) }))
  return { BASE, AREA_MIN_FROM_AKIB, shops, savedState, plan, trip, usingTripDays, days, rangeLabel, flight, labels, arrival, startDefaults, tripChoices }
}

// "Found here" for every shop (lib/shop-found.ts — the same list as the shop page), for the
// timeline's edit sheet, and the rate its prices are shown with: the default trip's, like the
// shop page and /prices. Only the timeline loads this. Empty when Sanity can't be reached.
export async function loadShopFinds(): Promise<{ found: Record<string, FoundItem[]>; rate: number | null }> {
  try {
    const [prices, purchases, trips]: [FoundPriceDoc[], FoundPurchaseDoc[], Awaited<ReturnType<typeof fetchTripsForSpending>>] = await Promise.all([
      sanity.fetch(foundPricesQuery('defined(shop._ref)')),
      sanity.fetch(foundPurchasesQuery('defined(store._ref)')),
      fetchTripsForSpending(),
    ])
    const byShop = new Map<string, { prices: FoundPriceDoc[]; purchases: FoundPurchaseDoc[] }>()
    const entry = (id: string) => byShop.get(id) || (byShop.set(id, { prices: [], purchases: [] }), byShop.get(id)!)
    for (const p of prices || []) if (p.shopId) entry(p.shopId).prices.push(p)
    for (const p of purchases || []) if (p.shopId) entry(p.shopId).purchases.push(p)
    const found: Record<string, FoundItem[]> = {}
    for (const [id, e] of byShop) found[id] = foundItems(e.prices, e.purchases)
    const rateTrip = pickDefaultTrip(trips)
    return { found, rate: rateTrip?.jpyToNokRate && rateTrip.jpyToNokRate > 0 ? rateTrip.jpyToNokRate : null }
  } catch (e) {
    return { found: {}, rate: null }
  }
}
