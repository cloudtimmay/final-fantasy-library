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

// The /family tab (and ?person= value) that lists a familyItem saved for `person`.
export function familyKeyFor(person: string): string {
  return person === OWNER ? OWNER_OTHER : person
}
