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
// the full-width space (U+3000) to a regular one, then strips whitespace and common
// punctuation entirely — so "FINAL FANTASY VII" and "ファイナルファンタジーⅦ"-style
// half/full-width variants of the same ASCII text compare equal, and "Vol. 1" / "vol1"
// style spacing/punctuation differences don't prevent a match.
export function normalizeForMatch(text: string | null | undefined): string {
  if (!text) return ''
  let s = text
  s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  s = s.replace(/　/g, ' ')
  s = s.toLowerCase()
  s = s.replace(/[\s\-_.,:;!?'"()[\]{}·・〜~]/g, '')
  return s.trim()
}

// Equal after normalizing, or one contains the other — but only once both sides are long
// enough that a substring match is actually meaningful (avoids e.g. a bare "ff" matching
// almost everything).
const MIN_SUBSTRING_LEN = 3
function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length < MIN_SUBSTRING_LEN || b.length < MIN_SUBSTRING_LEN) return false
  return a.includes(b) || b.includes(a)
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
      if (p.jan && p.jan.trim() === jan) {
        results.push({ product: p, matchType: 'jan', label: 'Same barcode' })
        matched.add(p)
      }
    }
  }

  const normName = normalizeForMatch(identified.productName)
  const normNameJp = normalizeForMatch(identified.productNameJp)
  if (normName || normNameJp) {
    for (const p of products) {
      if (matched.has(p)) continue
      const pName = normalizeForMatch(p.productName)
      const pNameJp = normalizeForMatch(p.productNameJp)
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
export type OwnedItem = {
  person: string
  name: string
  nameJp?: string
  jan?: string
}

export type OwnershipMatch = {
  person: string
  matchType: 'jan' | 'name'
}

// Same JAN-first-then-name-similarity logic as findProductMatches(), but keyed by person
// instead of by product — "<person> already has this" only needs to know WHO, not which of
// their (possibly several) matching records it was. At most one result per person, and a
// JAN match always wins over a name match for that person.
export function findOwnersOf(owned: OwnedItem[], identified: IdentifiedProduct): OwnershipMatch[] {
  const jan = (identified.jan || '').trim()
  const normName = normalizeForMatch(identified.productName)
  const normNameJp = normalizeForMatch(identified.productNameJp)

  const byPerson = new Map<string, OwnershipMatch>()
  for (const o of owned) {
    if (byPerson.get(o.person)?.matchType === 'jan') continue

    let matchType: 'jan' | 'name' | null = null
    if (jan && o.jan && o.jan.trim() === jan) {
      matchType = 'jan'
    } else if (normName || normNameJp) {
      const oName = normalizeForMatch(o.name)
      const oNameJp = normalizeForMatch(o.nameJp)
      if (namesMatch(normName, oName) || namesMatch(normNameJp, oNameJp) || namesMatch(normName, oNameJp) || namesMatch(normNameJp, oName)) {
        matchType = 'name'
      }
    }
    if (matchType) byPerson.set(o.person, { person: o.person, matchType })
  }
  return [...byPerson.values()]
}
