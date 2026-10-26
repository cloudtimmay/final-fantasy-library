// Shared, pure matching logic between an AI-identified (or scanned) product and the price
// list — used by both scan.astro ("In your price list") and prices.astro (filter + open
// the best match), so the two pages can never silently disagree on what counts as a match.

export type IdentifiedProduct = {
  productName?: string | null
  productNameJp?: string | null
  jan?: string | null
}

export type MatchableProduct = {
  jan?: string
  productName: string
  productNameJp?: string
}

export type ProductMatch<T extends MatchableProduct> = {
  product: T
  matchType: 'jan' | 'name'
  label: 'Same barcode' | 'Similar name'
}

// Lowercases, converts full-width (zenkaku) letters/digits/punctuation to their
// half-width (hankaku) equivalents (U+FF01-FF5E -> U+0021-007E, a fixed 0xFEE0 offset) and
// the full-width space (U+3000) to a regular one, drops a leading "The" and a "Vol."/
// "Volume"/"No." word in front of a number, then turns whitespace and common punctuation
// into single spaces between words — so "FINAL FANTASY VII" and "ファイナルファンタジーⅦ"-style
// half/full-width variants of the same ASCII text compare equal, "The Art of Final Fantasy
// XVI" equals "Art of Final Fantasy XVI", and "Ultimania Archive Vol. 1" equals "Ultimania
// Archive 1".
function wordsForMatch(text: string | null | undefined): string {
  if (!text) return ''
  let s = text
  s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  s = s.replace(/　/g, ' ')
  s = s.toLowerCase()
  s = s.replace(/^\s*the\s+/, '')
  s = s.replace(/\b(?:vol(?:ume)?|no)\.?\s*(?=\d)/g, '')
  s = s.replace(/[\s\-_.,:;!?'"()[\]{}·・〜~]+/g, ' ')
  return s.trim()
}

// The same, with the spaces dropped too — so "vol1" / "Vol 1" or "FinalFantasy" /
// "Final Fantasy" style spacing differences don't prevent an exact match.
export function normalizeForMatch(text: string | null | undefined): string {
  return wordsForMatch(text).replace(/ /g, '')
}

type MatchName = { compact: string; words: string }
function nameForMatch(text: string | null | undefined): MatchName {
  const words = wordsForMatch(text)
  return { compact: words.replace(/ /g, ''), words }
}

// ISBN-10 -> ISBN-13 (the 978 prefix plus a recomputed EAN check digit). Books carry the
// ISBN-13 as their EAN barcode, which is what a scan or identify reads; an ISBN-10 can still
// turn up in identify (printed on older covers) or typed in by hand.
export function isbn10ToIsbn13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  return core + String((10 - (sum % 10)) % 10)
}

// One comparable form for any barcode/ISBN: digits only (hyphens and spaces dropped), an
// ISBN-10 converted to ISBN-13, and a 12-digit UPC-A given the leading 0 that makes it the
// same EAN-13 a scanner may read. For COMPARING only — a stored JAN is never rewritten.
export function normalizeCode(code: string | null | undefined): string {
  if (!code) return ''
  const s = String(code).toUpperCase().replace(/[^0-9X]/g, '')
  if (/^\d{9}[\dX]$/.test(s)) return isbn10ToIsbn13(s)
  const digits = s.replace(/X/g, '')
  if (/^\d{12}$/.test(digits)) return '0' + digits
  return digits
}

export function codesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCode(a)
  return !!na && na === normalizeCode(b)
}

// How `a` relates to `b`: 0 = equal after normalizing (ignoring spacing), 1 = `a` appears
// inside `b` as whole words, 2 = `b` appears inside `a` as whole words, null = no match.
// Whole words, not characters: a plain substring check made "Final Fantasy XV" (and even
// "Final Fantasy X") match "Final Fantasy XVI". A subtitle on one side still matches ("X" is
// inside "X: Y" word for word). The shorter side needs at least 2 words (avoids a bare
// "Final" matching everything) — or Japanese/other non-ASCII text, which has no spaces, so
// one "word" there can be a whole title.
const MIN_SUBSTRING_LEN = 3
const MIN_WORDS = 2
function contains(long: MatchName, short: MatchName): boolean {
  if (short.compact.length < MIN_SUBSTRING_LEN) return false
  if (short.words.split(' ').length < MIN_WORDS && /^[\x00-\x7f]*$/.test(short.words)) return false
  return (' ' + long.words + ' ').includes(' ' + short.words + ' ')
}
function nameMatchRank(a: MatchName, b: MatchName): 0 | 1 | 2 | null {
  if (!a.compact || !b.compact) return null
  if (a.compact === b.compact) return 0
  if (contains(b, a)) return 1
  if (contains(a, b)) return 2
  return null
}
function namesMatch(a: MatchName, b: MatchName): boolean {
  return nameMatchRank(a, b) !== null
}

// nameMatchRank() for plain strings, for callers outside this module (store-lookup.ts):
// 0 = same name, 1 = `a` appears in `b` as whole words, 2 = `b` appears in `a`, null = no match.
export function compareNames(a: string | null | undefined, b: string | null | undefined): 0 | 1 | 2 | null {
  return nameMatchRank(nameForMatch(a), nameForMatch(b))
}

// Exact JAN matches first (labelled "Same barcode"), then name-similarity matches against
// either productName or productNameJp, normalized (labelled "Similar name") — a product
// already matched by JAN is never also listed as a name match. Order of the returned array
// is JAN matches first, so `matches[0]` is always the best available match.
export function findProductMatches<T extends MatchableProduct>(products: T[], identified: IdentifiedProduct): ProductMatch<T>[] {
  const results: ProductMatch<T>[] = []
  const matched = new Set<T>()

  const jan = (identified.jan || '').trim()
  if (jan) {
    for (const p of products) {
      if (codesMatch(p.jan, jan)) {
        results.push({ product: p, matchType: 'jan', label: 'Same barcode' })
        matched.add(p)
      }
    }
  }

  const normName = nameForMatch(identified.productName)
  const normNameJp = nameForMatch(identified.productNameJp)
  if (normName.compact || normNameJp.compact) {
    for (const p of products) {
      if (matched.has(p)) continue
      const pName = nameForMatch(p.productName)
      const pNameJp = nameForMatch(p.productNameJp)
      const hit =
        namesMatch(normName, pName) ||
        namesMatch(normNameJp, pNameJp) ||
        namesMatch(normName, pNameJp) ||
        namesMatch(normNameJp, pName)
      if (hit) {
        results.push({ product: p, matchType: 'name', label: 'Similar name' })
        matched.add(p)
      }
    }
  }

  return results
}

// One thing a family member already owns, already normalized across its three possible
// Sanity sources (familyItem, a bought familyPurchase, a bought priceEntry) by whichever
// server-side query builds this list — see fetchOwnedByPerson() in src/lib/price-products.ts.
// `familyItemId`: set when the record is a familyItem — for the owner, one of their "other
// things" (see fetchOwnedByPerson()), which the "already have this" notes link to.
export type OwnedItem = {
  person: string
  name: string
  nameJp?: string
  jan?: string
  familyItemId?: string
}

// `item`: the record that matched (the barcode match, if any), with its familyItem id if it is one.
export type OwnershipMatch = {
  person: string
  matchType: 'jan' | 'name'
  item: { name: string; familyItemId?: string }
}

// Same JAN-first-then-name-similarity logic as findProductMatches(), but keyed by person
// instead of by product — "<person> already has this" is about WHO; `item` is just one of
// their matching records (the owner's note links to it). At most one result per person, and a
// JAN match always wins over a name match for that person.
export function findOwnersOf(owned: OwnedItem[], identified: IdentifiedProduct): OwnershipMatch[] {
  const jan = (identified.jan || '').trim()
  const normName = nameForMatch(identified.productName)
  const normNameJp = nameForMatch(identified.productNameJp)

  const byPerson = new Map<string, OwnershipMatch>()
  for (const o of owned) {
    if (byPerson.get(o.person)?.matchType === 'jan') continue

    let matchType: 'jan' | 'name' | null = null
    if (jan && codesMatch(o.jan, jan)) {
      matchType = 'jan'
    } else if (normName.compact || normNameJp.compact) {
      const oName = nameForMatch(o.name)
      const oNameJp = nameForMatch(o.nameJp)
      if (namesMatch(normName, oName) || namesMatch(normNameJp, oNameJp) || namesMatch(normName, oNameJp) || namesMatch(normNameJp, oName)) {
        matchType = 'name'
      }
    }
    if (matchType && !(matchType === 'name' && byPerson.has(o.person))) {
      byPerson.set(o.person, { person: o.person, matchType, item: { name: o.name, ...(o.familyItemId ? { familyItemId: o.familyItemId } : {}) } })
    }
  }
  return [...byPerson.values()]
}

// One of the owner's own collection items (album/game/book/figure). The schemas have no
// separate Japanese title, so an identified Japanese name is compared against `title` too.
export type CollectionItem = {
  _id: string
  _type: string
  title: string
  barcode?: string | null
  isbn?: string | null
  status?: string | null
}

export type CollectionMatch<T extends CollectionItem> = {
  item: T
  matchType: 'jan' | 'name'
  label: 'Same barcode' | 'Similar name'
}

// Same rule as the collection pages: anything not on the wishlist counts as owned —
// including the many items imported without a status at all — except one that's been sold.
export function isOwnedStatus(status: string | null | undefined): boolean {
  return status !== 'wishlist' && status !== 'sold'
}

// Same JAN-first-then-name logic as findProductMatches(), against the collection: the
// identified code is compared with a book's `isbn` and with every other type's `barcode`;
// names compare the identified English and Japanese names against the item's title. Name
// matches are ordered best first — an equal title, then a title that contains the whole
// identified name, then a shorter title the identified name contains — since a few hundred
// titles share words like "Final Fantasy" and only the first few are shown.
export function findCollectionMatches<T extends CollectionItem>(items: T[], identified: IdentifiedProduct): CollectionMatch<T>[] {
  const results: CollectionMatch<T>[] = []
  const matched = new Set<T>()

  const jan = (identified.jan || '').trim()
  if (jan) {
    for (const item of items) {
      const code = item._type === 'book' ? item.isbn : item.barcode
      if (codesMatch(code, jan)) {
        results.push({ item, matchType: 'jan', label: 'Same barcode' })
        matched.add(item)
      }
    }
  }

  const normName = nameForMatch(identified.productName)
  const normNameJp = nameForMatch(identified.productNameJp)
  if (normName.compact || normNameJp.compact) {
    const byName: { item: T; rank: number }[] = []
    for (const item of items) {
      if (matched.has(item)) continue
      const title = nameForMatch(item.title)
      const ranks = [nameMatchRank(normName, title), nameMatchRank(normNameJp, title)].filter((r): r is 0 | 1 | 2 => r !== null)
      if (ranks.length) byName.push({ item, rank: Math.min(...ranks) })
    }
    byName.sort((a, b) => a.rank - b.rank)
    for (const { item } of byName) results.push({ item, matchType: 'name', label: 'Similar name' })
  }

  return results
}
