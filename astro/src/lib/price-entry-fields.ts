// Allowed values for priceEntry's enum-like fields, shared by every endpoint that
// creates or updates a priceEntry document, so a default/guard added in one place
// never drifts out of sync with another.
export const CATEGORIES = ['album', 'game', 'book', 'figure', 'other']
export const SOURCE_TYPES = ['japanStore', 'online', 'norway']
export const CURRENCIES = ['JPY', 'NOK', 'USD', 'EUR']
export const CONDITIONS = ['new', 'used', 'used_complete']
export const STATUSES = ['considering', 'bought']
