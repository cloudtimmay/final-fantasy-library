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
