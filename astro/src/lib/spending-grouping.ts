import { OWNER } from './price-entry-fields'

// ¥5,000 before tax is Japan's per-shop-per-day tax-free threshold; at 10% consumption
// tax that's ¥5,500 tax-included. "Spent" is always tracked tax-included (see
// familyPurchase.priceYen's description), so the threshold is compared tax-included too.
export const TAX_FREE_THRESHOLD_INCL_JPY = 5500

export type FamilyPurchaseDoc = {
  _id: string
  name: string
  person: string // whose budget this counts against
  passportHolder?: string // whose passport was shown at the register — missing means OWNER
  taxFree?: boolean // paid with a passport at all — missing means true
  status: 'planned' | 'bought'
  priceNok?: number
  priceYen?: number
  purchaseDate?: string
  barcode?: string
  storeId?: string
  storeName?: string
  taxFreeShop: boolean | null
  photoUrl?: string
}

// Japan's tax-free threshold and refund are per passport shown at the register, not per
// budget owner — Kim usually pays for everyone regardless of whose budget an item counts
// against (FamilyPurchaseDoc.person). A missing passportHolder means Kim paid.
export function passportHolderOf(p: FamilyPurchaseDoc): string {
  return p.passportHolder || OWNER
}

// A purchase paid for without showing a passport at all (e.g. a snack eaten during the
// trip) still counts toward budgets, bought and duty-free per person — it just never
// counts toward the tax-free threshold, the estimated refund, or the departure checklist.
// Missing means tax-free (true), same convention as passportHolderOf.
export function isTaxFree(p: FamilyPurchaseDoc): boolean {
  return p.taxFree !== false
}

export type PassportShopDayGroup = {
  key: string // stable id for this (passportHolder, store, day) group, for localStorage/DOM
  passportHolder: string
  storeName: string
  day: string
  taxFreeShop: boolean | null
  // Every bought item at this (passport holder, store, day) — including ones marked
  // not tax-free, so the spending page can list and toggle each one. Each item carries
  // its own `person` (whose budget it counts against) and `taxFree` flag.
  items: FamilyPurchaseDoc[]
  totalInclJpy: number // sum of only the tax-free items among `items`
  reached: boolean
  missingInclJpy: number
  estimatedRefundJpy: number
}

// Groups BOUGHT familyPurchase rows by (passport holder, shop, day) — Japan's tax-free
// threshold and refund are checked per passport shown at the register, not per budget
// owner, so e.g. two family members' purchases both paid for with Kim's passport at the
// same shop/day DO combine toward the threshold, even though they count against different
// people's budgets. Bought only, since the threshold is about purchases that actually
// happened, not ones still being considered. A purchase marked not tax-free is still
// listed on its group (so it can be reviewed/toggled) but excluded from the group's
// tax-free total. Pure — no I/O — so it can be imported both server-side (spending.astro,
// /checklist) and from a client <script> (the spending page's live toggle) without
// pulling in the Sanity client. Shared by the spending page's overview and the airport
// checklist — the only difference between them is which groups/items each one shows (the
// checklist only cares about tax-free items in groups that have reached the threshold).
export function groupBoughtByPassportShopDay(familyPurchases: FamilyPurchaseDoc[]): PassportShopDayGroup[] {
  const groups = new Map<string, PassportShopDayGroup>()
  for (const p of familyPurchases) {
    if (p.status !== 'bought') continue
    if (!p.priceYen) continue // only JPY shop purchases are relevant to Japan's tax-free system
    const passportHolder = passportHolderOf(p)
    const storeName = (p.storeName && p.storeName.trim()) || '— No store —'
    const day = p.purchaseDate || '— No date —'
    const key = `${passportHolder}||${storeName}||${day}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        passportHolder,
        storeName,
        day,
        taxFreeShop: p.taxFreeShop,
        items: [],
        totalInclJpy: 0,
        reached: false,
        missingInclJpy: 0,
        estimatedRefundJpy: 0,
      }
      groups.set(key, g)
    }
    g.items.push(p)
    if (isTaxFree(p)) g.totalInclJpy += p.priceYen
  }
  return [...groups.values()]
    .map((g) => {
      const reached = g.totalInclJpy >= TAX_FREE_THRESHOLD_INCL_JPY
      const missingInclJpy = reached ? 0 : TAX_FREE_THRESHOLD_INCL_JPY - g.totalInclJpy
      const estimatedRefundJpy = reached && g.taxFreeShop === true ? g.totalInclJpy / 11 : 0
      return { ...g, reached, missingInclJpy, estimatedRefundJpy }
    })
    .sort((a, b) => a.passportHolder.localeCompare(b.passportHolder) || b.day.localeCompare(a.day) || a.storeName.localeCompare(b.storeName))
}
