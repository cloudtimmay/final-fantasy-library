// Possibly-the-same products in the price list. Never merged automatically: a Japanese name
// is often just the character ("アルフォンス・エルリック"), shared by many different products
// — a figure, a Dodoroid, a keychain. So a match is only ever a hint: /add-price shows a
// "Possible match" (with "Use existing"), and /prices a "Possible duplicate of …" note with a
// Merge button that asks first. Pure functions — used server-side by /prices and in the
// browser by /add-price.

// Shorter Japanese names (after normalizing) are too generic to suggest anything.
export const MIN_JP_MATCH_LENGTH = 4

// NFKC (full-width letters/digits and half-width katakana -> their standard forms), lower
// case, then whitespace and punctuation removed — the ・ between a first and last name, brackets
// of any width, dashes, slashes. The long-vowel mark ー is part of the word and stays.
export function normalizeJpName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・･.,:;!?'"()[\]{}「」『』【】〈〉《》〔〕〜~\-_/\\&+*#@。、]+/g, '')
}

// Both Japanese names normalize to the same thing, and it's long enough to mean something.
export function jpNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeJpName(a)
  return na.length >= MIN_JP_MATCH_LENGTH && na === normalizeJpName(b)
}

export type DuplicateCandidate = {
  key: string
  productName: string
  productNameJp?: string
  jan?: string
  category?: string
  image?: { assetId?: string } | null
  prices: unknown[]
}

// Which of two products a merge keeps: the one with a JAN (it identifies the exact
// product), otherwise — or if both have one — the one with more prices; `a` on a tie.
export function pickKeptProduct<T extends DuplicateCandidate>(a: T, b: T): { kept: T; merged: T } {
  const aJan = !!a.jan, bJan = !!b.jan
  if (aJan !== bJan) return aJan ? { kept: a, merged: b } : { kept: b, merged: a }
  return b.prices.length > a.prices.length ? { kept: b, merged: a } : { kept: a, merged: b }
}

export type DuplicatePair<T> = { kept: T; merged: T; reason: 'jp-name' | 'image' }

// Every pair of products in the same category with the same normalized Japanese name or
// the same photo (image asset) — each pair once.
export function findPossibleDuplicates<T extends DuplicateCandidate>(products: T[]): DuplicatePair<T>[] {
  const pairs: DuplicatePair<T>[] = []
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i], b = products[j]
      if (!a.category || a.category !== b.category) continue
      const sameImage = !!a.image?.assetId && a.image.assetId === b.image?.assetId
      const sameJp = jpNamesMatch(a.productNameJp, b.productNameJp)
      if (!sameImage && !sameJp) continue
      pairs.push({ ...pickKeptProduct(a, b), reason: sameJp ? 'jp-name' : 'image' })
    }
  }
  return pairs
}
