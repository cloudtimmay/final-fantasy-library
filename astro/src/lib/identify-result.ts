// Validation of /api/identify-product's model output, and the rule for which currency an
// identified price goes in on /add-price — pulled out of identify-product.ts so both can be
// imported and tested directly (identify-product.ts itself uses `import.meta.env`, which
// Playwright's test transform can't load — same reason as find-prices-prompt.ts).
import { CATEGORIES } from './price-entry-fields'
import { isbn10ToIsbn13 } from './product-match'

// /api/identify-product's system prompt — here rather than in the endpoint so tests can read
// it. Both names must be the FULL product name: a Japanese name that's only the character
// ("アルフォンス・エルリック") matches many different products, which /add-price and /prices
// use to suggest possible duplicates (lib/product-duplicates.ts).
export const IDENTIFY_SYSTEM_PROMPT = `You are looking at one or more photos of the same product in a shop — usually in Japan, sometimes in Norway (Final Fantasy and other games, music, books, and merchandise). The photos may show different sides or details of the same item — for example the front, the back with a barcode, or a separate close-up of a price tag. Combine the information from all of the photos into a single identification. Return ONLY a JSON object, with no other text, no markdown code fences, and no explanation. The JSON object must have exactly these fields:
- productName: string, the product's full name in English — the whole product as sold, not only the character or series: product line or type, character, and edition/variant (e.g. "Nendoroid Alphonse Elric", "Fullmetal Alchemist Alphonse Elric Pop Up Parade figure", "Final Fantasy VII Rebirth Deluxe Edition (PS5)").
- productNameJp: string, the product's full name in Japanese exactly as printed on the packaging — product line, character and edition together (e.g. "ねんどろいど アルフォンス・エルリック"), never only the character's name ("アルフォンス・エルリック" alone describes many different products); null if not visible.
- jan: string of digits only, the JAN/EAN/UPC barcode (for a book, its ISBN), ONLY if clearly readable on the packaging, otherwise null.
- category: one of "album", "game", "book", "figure", "other". "figure" means any merchandise (plushies, wearables, statues, etc.), not just figures specifically.
- price: number, the price shown on a visible price tag, or null if no price tag is visible.
- currency: the currency shown on the price tag — "JPY" if it shows ¥ or 円, "NOK" if it shows kr or NOK, or null if there is no price tag or the currency is not shown.
- taxIncluded: only for a yen price — true if the price tag shows 税込 (tax included), false if it shows 税抜 (tax excluded), null if unclear, if there is no price tag, or if the price is not in yen.
- confidence: one of "high", "medium", "low" for your overall confidence in this identification.
- notes: a short string noting anything relevant (e.g. "price tag partially hidden"), or null if there is nothing to note.`

// The only currencies a price tag photo is expected to show: ¥/円 in Japan, kr/NOK in Norway.
export const IDENTIFY_CURRENCIES = ['JPY', 'NOK']

export type IdentifyResult = {
  productName?: string
  productNameJp?: string
  jan?: string
  category?: string
  price?: number
  currency?: 'JPY' | 'NOK'
  taxIncluded?: boolean
  confidence?: 'high' | 'medium' | 'low'
  notes?: string
}

// Every field checked against the same rules used elsewhere for a priceEntry; anything
// invalid is dropped rather than failing the whole request.
export function validateIdentifyResult(parsed: any): IdentifyResult {
  const result: IdentifyResult = {}
  if (!parsed || typeof parsed !== 'object') return result

  if (typeof parsed.productName === 'string' && parsed.productName.trim()) {
    result.productName = parsed.productName.trim()
  }
  if (typeof parsed.productNameJp === 'string' && parsed.productNameJp.trim()) {
    result.productNameJp = parsed.productNameJp.trim()
  }
  if (typeof parsed.jan === 'string') {
    // An ISBN-10 (last character may be X) becomes the ISBN-13 a book's barcode carries;
    // otherwise the digits are kept exactly as read (a 12-digit UPC is NOT padded here, since
    // the JAN is also a price-list grouping key — see productKey()).
    const code = parsed.jan.toUpperCase().replace(/[^0-9X]/g, '')
    if (/^\d{9}[\dX]$/.test(code)) result.jan = isbn10ToIsbn13(code)
    else if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length)) result.jan = code
  }
  if (CATEGORIES.includes(parsed.category)) {
    result.category = parsed.category
  }
  if (typeof parsed.price === 'number' && isFinite(parsed.price) && parsed.price >= 0) {
    result.price = parsed.price
  }
  if (IDENTIFY_CURRENCIES.includes(parsed.currency)) {
    result.currency = parsed.currency
  }
  // 税込/税抜 only exists on a yen price tag — a NOK price always includes MVA, so a
  // taxIncluded the model reports alongside a NOK price is meaningless and dropped.
  if (typeof parsed.taxIncluded === 'boolean' && result.currency !== 'NOK') {
    result.taxIncluded = parsed.taxIncluded
  }
  if (['high', 'medium', 'low'].includes(parsed.confidence)) {
    result.confidence = parsed.confidence
  }
  if (typeof parsed.notes === 'string' && parsed.notes.trim()) {
    result.notes = parsed.notes.trim()
  }
  return result
}

// Which currency an identified price is entered in on /add-price: the currency read off
// the tag if the model reported one; otherwise the form's selected source decides — a Japan
// shop is JPY, a Norwegian store is NOK, and Online could be anything, so the currency the
// form already has is left alone.
export function currencyForIdentifiedPrice(tagCurrency: unknown, source: string, currentCurrency: string): string {
  if (typeof tagCurrency === 'string' && IDENTIFY_CURRENCIES.includes(tagCurrency)) return tagCurrency
  return currencyForSource(source, currentCurrency)
}

// The currency a source implies, used when the source radio is switched on /add-price and
// /edit-price (and above, when a tag shows no currency): a Japan shop is JPY, a Norwegian
// store is NOK, and Online could be anything, so the current currency is left alone.
export function currencyForSource(source: string, currentCurrency: string): string {
  if (source === 'japanStore') return 'JPY'
  if (source === 'norway') return 'NOK'
  return currentCurrency
}
