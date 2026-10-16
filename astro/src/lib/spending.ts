import { sanity } from './sanity'
import { productKey } from './price-products'
import type { FamilyPurchaseDoc } from './spending-grouping'

export type { FamilyPurchaseDoc }
export {
  TAX_FREE_THRESHOLD_INCL_JPY,
  passportHolderOf,
  isTaxFree,
  groupBoughtByPassportShopDay,
  type PassportShopDayGroup,
} from './spending-grouping'

// Norway's duty-free (toll-free) import allowance for goods brought back from outside
// the EU. Verify the current threshold on toll.no before relying on this — it changes
// from time to time and this is not read from any official source.
export const NORWAY_DUTY_FREE_ALLOWANCE_NOK = 6000

export type ChildBudget = { person: string; budgetNok?: number; budgetYen?: number }

export type SpendingTrip = {
  _id: string
  label?: string
  startDate?: string
  endDate?: string
  budgetNok?: number
  budgetYen?: number
  // Left undefined when the trip genuinely has none set — callers that need a usable
  // number for computation (not just to check whether one exists) apply their own
  // fallback, same as this file's other optional numeric fields. Defaulting it here
  // instead would make a real "no rate configured" indistinguishable from a trip whose
  // rate actually happens to equal that default.
  jpyToNokRate?: number
  childBudgets: ChildBudget[]
}

export async function fetchTripsForSpending(): Promise<SpendingTrip[]> {
  const raw: any[] = await sanity.fetch(`
    *[_type == "tripSettings"] | order(_createdAt asc) {
      _id, label, startDate, endDate, budgetNok, budgetYen, jpyToNokRate,
      childBudgets[]{ person, budgetNok, budgetYen }
    }
  `)
  return raw.map((t) => ({
    _id: t._id,
    label: t.label,
    startDate: t.startDate || undefined,
    endDate: t.endDate || undefined,
    budgetNok: t.budgetNok ?? undefined,
    budgetYen: t.budgetYen ?? undefined,
    jpyToNokRate: t.jpyToNokRate ?? undefined,
    childBudgets: (t.childBudgets || []).filter((c: any) => c.person),
  }))
}

// Default trip when none is requested via ?trip=: the one ongoing today, otherwise the
// next upcoming one, otherwise the most recent past one. Trips missing a startDate can't
// be placed on that timeline at all, so they sort last (first undated trip, in whatever
// order fetchTripsForSpending returned them).
export function pickDefaultTrip(trips: SpendingTrip[], today: Date = new Date()): SpendingTrip | null {
  if (trips.length === 0) return null
  const todayStr = today.toISOString().split('T')[0]

  const dated = trips.filter((t) => !!t.startDate)
  const undated = trips.filter((t) => !t.startDate)

  const ongoing = dated.find((t) => t.startDate! <= todayStr && todayStr <= (t.endDate || t.startDate!))
  if (ongoing) return ongoing

  const upcoming = dated.filter((t) => t.startDate! > todayStr).sort((a, b) => a.startDate!.localeCompare(b.startDate!))
  if (upcoming.length > 0) return upcoming[0]

  const past = dated
    .filter((t) => (t.endDate || t.startDate!) < todayStr)
    .sort((a, b) => (b.endDate || b.startDate!).localeCompare(a.endDate || a.startDate!))
  if (past.length > 0) return past[0]

  return undated[0] || trips[0]
}

export async function fetchFamilyPurchasesForTrip(tripId: string): Promise<FamilyPurchaseDoc[]> {
  const raw: any[] = await sanity.fetch(
    `*[_type == "familyPurchase" && !(_id in path("drafts.**")) && trip._ref == $tripId] {
      _id, name, person, passportHolder, taxFree, status, priceNok, priceYen, purchaseDate, barcode,
      "storeId": store._ref,
      "storeName": store->shopName,
      "taxFreeShop": store->taxFreeShop,
      "photoUrl": photos[0].asset->url
    }`,
    { tripId }
  )
  return raw.map((p) => ({
    ...p,
    taxFreeShop: p.taxFreeShop ?? null,
    photoUrl: p.photoUrl ?? undefined,
    taxFree: p.taxFree ?? undefined,
  }))
}

export type PlannedPriceDoc = {
  _id: string
  productName: string
  jan?: string
  price: number
  currency: string
}

// "Planned" from the price-tracking side: a person's still-Considering priceEntries for
// this trip. priceEntry doesn't have a "which trip is this for" concept beyond the trip
// reference it already carries (set via the buyer/trip fields on add-price/edit-price).
export async function fetchPlannedPriceEntries(buyer: string, tripId: string): Promise<PlannedPriceDoc[]> {
  return sanity.fetch(
    `*[_type == "priceEntry" && !(_id in path("drafts.**")) && status == "considering" && buyer == $buyer && trip._ref == $tripId] {
      _id, productName, jan, price, currency
    }`,
    { buyer, tripId }
  )
}

function toNok(amountJpyOrNok: number, currency: 'JPY' | 'NOK', jpyToNokRate: number): number {
  return currency === 'JPY' ? amountJpyOrNok * jpyToNokRate : amountJpyOrNok
}

export type CheapestPlannedTotal = { nok: number; excludedCurrencyCount: number }

// Among a person's planned priceEntries, keeps only the cheapest entry per product key
// (same product seen at several shops shouldn't count more than once), converting JPY at
// the trip's rate. Entries in a currency other than JPY/NOK can't be converted here and
// are dropped from the total — the caller surfaces excludedCurrencyCount so the UI can
// say so rather than silently under-counting.
export function sumCheapestPlanned(docs: PlannedPriceDoc[], jpyToNokRate: number): CheapestPlannedTotal {
  const cheapestByKey = new Map<string, number>() // key -> NOK amount
  let excludedCurrencyCount = 0
  for (const d of docs) {
    if (d.currency !== 'JPY' && d.currency !== 'NOK') {
      excludedCurrencyCount++
      continue
    }
    const nok = toNok(d.price, d.currency, jpyToNokRate)
    const key = productKey(d.jan, d.productName)
    const existing = cheapestByKey.get(key)
    if (existing === undefined || nok < existing) cheapestByKey.set(key, nok)
  }
  let nok = 0
  for (const amount of cheapestByKey.values()) nok += amount
  return { nok, excludedCurrencyCount }
}

export type PlannedForPerson = { totalNok: number; excludedCurrencyCount: number }

// Combines both sources of "planned": still-Considering priceEntries (deduped to
// cheapest per product key) and planned familyPurchase documents. Both must count per
// product decision — but a priceEntry whose JAN exactly matches a planned
// familyPurchase's barcode is assumed to be the same physical item and is dropped from
// the priceEntry side to avoid double-counting it. This only catches exact barcode
// matches; a planned item logged on both sides without a barcode on either (or with a
// barcode on only one) cannot be matched and is counted on both — see the implementation
// report for how often this is expected to matter in practice.
export function sumPlannedForPerson(
  priceEntryDocs: PlannedPriceDoc[],
  personFamilyPurchases: FamilyPurchaseDoc[],
  jpyToNokRate: number
): PlannedForPerson {
  const plannedFps = personFamilyPurchases.filter((p) => p.status === 'planned')
  const fpBarcodes = new Set(plannedFps.map((p) => p.barcode).filter(Boolean))

  const unmatchedPriceEntries = priceEntryDocs.filter((d) => !(d.jan && fpBarcodes.has(d.jan)))
  const { nok: priceEntryNok, excludedCurrencyCount } = sumCheapestPlanned(unmatchedPriceEntries, jpyToNokRate)

  let fpNok = 0
  for (const p of plannedFps) {
    fpNok += (p.priceYen ? p.priceYen * jpyToNokRate : 0) + (p.priceNok || 0)
  }

  return { totalNok: priceEntryNok + fpNok, excludedCurrencyCount }
}

export function sumBoughtNok(familyPurchases: FamilyPurchaseDoc[], jpyToNokRate: number, person?: string): number {
  let nok = 0
  for (const p of familyPurchases) {
    if (p.status !== 'bought') continue
    if (person && p.person !== person) continue
    nok += (p.priceYen ? p.priceYen * jpyToNokRate : 0) + (p.priceNok || 0)
  }
  return nok
}

export type PersonSpending = {
  person: string
  budgetNok: number | null
  boughtNok: number
  plannedNok: number
  plannedExcludedCurrencyCount: number
  remainingNok: number | null
  overBudgetWithPlanned: boolean
  dutyFreeOverNok: number // positive if over the allowance, 0 or negative if under
}

export function computePersonSpending(
  person: string,
  childBudgets: ChildBudget[],
  allFamilyPurchases: FamilyPurchaseDoc[],
  plannedPriceEntries: PlannedPriceDoc[],
  jpyToNokRate: number
): PersonSpending {
  const cb = childBudgets.find((c) => c.person === person)
  const budgetNok = cb ? (cb.budgetNok ?? (cb.budgetYen != null ? cb.budgetYen * jpyToNokRate : null)) ?? null : null

  const personFamilyPurchases = allFamilyPurchases.filter((p) => p.person === person)
  const boughtNok = sumBoughtNok(personFamilyPurchases, jpyToNokRate)
  const { totalNok: plannedNok, excludedCurrencyCount } = sumPlannedForPerson(plannedPriceEntries, personFamilyPurchases, jpyToNokRate)

  const remainingNok = budgetNok != null ? budgetNok - boughtNok : null
  const overBudgetWithPlanned = budgetNok != null && boughtNok + plannedNok > budgetNok

  return {
    person,
    budgetNok,
    boughtNok,
    plannedNok,
    plannedExcludedCurrencyCount: excludedCurrencyCount,
    remainingNok,
    overBudgetWithPlanned,
    dutyFreeOverNok: boughtNok - NORWAY_DUTY_FREE_ALLOWANCE_NOK,
  }
}

