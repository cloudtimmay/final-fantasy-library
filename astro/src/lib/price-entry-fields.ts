// Allowed values for priceEntry's enum-like fields, shared by every endpoint that
// creates or updates a priceEntry document, so a default/guard added in one place
// never drifts out of sync with another.
export const CATEGORIES = ['album', 'game', 'book', 'figure', 'other']
export const SOURCE_TYPES = ['japanStore', 'online', 'norway']
export const CURRENCIES = ['JPY', 'NOK', 'USD', 'EUR']
export const CONDITIONS = ['new', 'used', 'used_complete']
export const STATUSES = ['considering', 'bought']

// Must match sanity/schemaTypes/peopleList.ts — duplicated here because the Astro app
// and the Sanity Studio are separate packages with no shared module path between them
// (same reason CATEGORY_LABELS-style small lists are duplicated elsewhere in this app).
export const PEOPLE_LIST = ['Kim', 'Tone', 'Niklas', 'Kristina', 'Richard']

// The one person who owns this collection. Marking a priceEntry "Bought" with this as
// the buyer is the only case that also creates/updates a collection item — every other
// buyer only ever produces a familyPurchase.
export const OWNER = 'Kim'

// The owner's "other things" (not Final Fantasy, e.g. Gundam figures): familyItem documents
// with person OWNER — kept out of the collection lists, still checked by "already have this".
// This key picks them wherever a person is chosen: /add-item?owner=, /family?person=.
export const OWNER_OTHER = `${OWNER}-other`

// "Who owns it?" on /add-item, in display order. `person` is what gets saved; `familyItem`:
// saved as a familyItem (everyone but the owner's Final Fantasy collection).
export const OWNER_CHOICES: { key: string; label: string; person: string; familyItem: boolean }[] = [
  { key: OWNER, label: `${OWNER} – Final Fantasy collection`, person: OWNER, familyItem: false },
  { key: OWNER_OTHER, label: `${OWNER} – other things`, person: OWNER, familyItem: true },
  ...PEOPLE_LIST.filter((p) => p !== OWNER).map((p) => ({ key: p, label: p, person: p, familyItem: true })),
]

// Where an owner purchase goes when it's marked Bought (/add-price, /edit-price,
// /api/price-entry-update): a collection item, or a familyItem among the owner's "other
// things". Category "other" defaults to other things, everything else to the collection.
export const ADD_TO = ['collection', 'other']
export function defaultAddTo(category: string | null | undefined): 'collection' | 'other' {
  return category === 'other' ? 'other' : 'collection'
}

// The /family tab (and ?person= value) that lists a familyItem saved for `person`.
export function familyKeyFor(person: string): string {
  return person === OWNER ? OWNER_OTHER : person
}

// --- Marking a price Bought: /edit-price and the timeline's "Found here" strip --------------
// The same checks and request on both, against /api/price-entry-update (which repeats the
// checks on the server).

// An amount is only recorded on a familyPurchase (needs a trip) or on the owner's collection
// item — an owner purchase going to "other things" makes a familyItem, which has no price — so
// only then must the price be in JPY or NOK.
export function boughtRecordsAmount(buyer: string | null | undefined, tripId: string | null | undefined, addTo: string | null | undefined): boolean {
  return !!tripId || (buyer === OWNER && addTo === 'collection')
}
export const BOUGHT_CURRENCY_ERROR = 'Mark as Bought requires the price to be in JPY or NOK. Please enter the price in NOK.'

// The client's checks before a Bought save: the message to show, or null when it can go.
export function boughtPreCheck(v: { buyer?: string | null; tripId?: string | null; addTo?: string | null; currency?: string | null }): string | null {
  if (!v.buyer) return 'Please choose who bought it.'
  if (boughtRecordsAmount(v.buyer, v.tripId, v.addTo) && v.currency !== 'JPY' && v.currency !== 'NOK') return BOUGHT_CURRENCY_ERROR
  return null
}

// A stored priceEntry's values as /edit-price's form shows them: a missing source is Shop in
// Japan, a missing currency JPY, a missing condition New, and tax is included unless it's
// explicitly not. The timeline's strip sends exactly these, as /edit-price would.
export function priceEntryFormValues(e: { sourceType?: string | null; currency?: string | null; condition?: string | null; taxIncluded?: boolean | null }) {
  return {
    sourceType: e.sourceType === 'online' || e.sourceType === 'norway' ? e.sourceType : 'japanStore',
    currency: e.currency && CURRENCIES.includes(e.currency) ? e.currency : 'JPY',
    condition: e.condition === 'used' || e.condition === 'used_complete' ? e.condition : 'new',
    taxIncluded: e.taxIncluded !== false,
  }
}

// The request body for /api/price-entry-update. It replaces every field of the entry (and
// unsets what's missing), so every current value goes in — from /edit-price's form, or the
// timeline's copy of the entry. Fields that don't apply are left out the same way on both.
export type PriceEntryUpdate = {
  id: string
  status: string
  buyer?: string | null
  addTo?: string | null
  tripId?: string | null
  passportHolder?: string | null
  sourceType: string
  shopId?: string | null
  sourceName?: string | null
  url?: string | null
  price: string | number
  currency: string
  taxIncluded?: boolean
  extraCost?: string | number | null
  condition: string
  note?: string | null
  hiddenFromPicks?: boolean // "🎁 Hide from Picks" — left out (unchanged) when not given
}
export function priceEntryUpdateBody(f: PriceEntryUpdate) {
  const japan = f.sourceType === 'japanStore'
  return {
    id: f.id,
    status: f.status,
    buyer: f.buyer || undefined,
    addTo: f.buyer === OWNER ? f.addTo || undefined : undefined,
    tripId: f.tripId || undefined,
    passportHolder: f.status === 'bought' ? f.passportHolder || undefined : undefined,
    sourceType: f.sourceType,
    shopId: japan ? f.shopId || undefined : undefined,
    sourceName: !japan ? (f.sourceName || '').trim() || undefined : undefined,
    url: !japan ? (f.url || '').trim() || undefined : undefined,
    price: f.price,
    currency: f.currency,
    taxIncluded: f.currency === 'JPY' ? f.taxIncluded : undefined,
    extraCost: f.extraCost === '' || f.extraCost == null ? undefined : f.extraCost,
    condition: f.condition,
    note: (f.note || '').trim() || undefined,
    hiddenFromPicks: typeof f.hiddenFromPicks === 'boolean' ? f.hiddenFromPicks : undefined,
  }
}
