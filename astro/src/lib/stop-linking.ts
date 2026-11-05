// Linking itinerary stops to shops (shopNote): a stop with a shopId takes the shop's name,
// coordinates, hours and area (itinerary-plan.ts resolveStop / stopHoursText). Stops written by
// hand — and the old template stops — have none. This finds a matching shop by name for each
// unlinked stop, for the timeline's "🔗 Link stops to shops" review list and the edit sheet's
// "🔗 Link to shop"; nothing is changed until the page saves what was confirmed. Pure.

export type LinkShop = { _id: string; shopName?: string | null; area?: string | null }
export type LinkStop = { name?: string | null; shopId?: string | null }
export type LinkDay = { day: string; stops: LinkStop[] }

// "🍜 Tsujita Akihabara" -> ["tsujita", "akihabara"]: NFKC, lowercase, letters and digits only
// (any script), so emoji, punctuation and full-width forms don't matter.
export function nameTokens(name: string | null | undefined): string[] {
  return String(name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}
const compact = (tokens: string[]) => tokens.join('')

// How alike two names are: 'exact' (the same once normalised), 'close' (one contains the other
// and is at least half its length, or they share at least two words and most of their words), or
// null — so "Yellow Submarine Shinjuku" never matches "Yellow Submarine Akihabara RPG Shop".
export function nameMatch(a: string | null | undefined, b: string | null | undefined): { kind: 'exact' | 'close'; score: number } | null {
  const ta = nameTokens(a), tb = nameTokens(b)
  const ca = compact(ta), cb = compact(tb)
  if (!ca || !cb) return null
  if (ca === cb) return { kind: 'exact', score: 1 }
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca]
  if (short.length >= 5 && long.includes(short) && short.length / long.length >= 0.5) return { kind: 'close', score: short.length / long.length }
  const sa = new Set(ta), sb = new Set(tb)
  const shared = [...sa].filter((t) => sb.has(t)).length
  const jaccard = shared / new Set([...sa, ...sb]).size
  if (shared >= 2 && jaccard >= 0.6) return { kind: 'close', score: jaccard }
  return null
}

// The best shop for a stop's name: an exact match first, else the closest close one.
export function suggestShop(stopName: string | null | undefined, shops: LinkShop[]): { shop: LinkShop; kind: 'exact' | 'close' } | null {
  let best: { shop: LinkShop; kind: 'exact' | 'close'; score: number } | null = null
  for (const shop of shops) {
    const m = nameMatch(stopName, shop.shopName)
    if (!m) continue
    if (!best || (m.kind === 'exact' && best.kind !== 'exact') || (m.kind === best.kind && m.score > best.score)) best = { shop, kind: m.kind, score: m.score }
  }
  return best ? { shop: best.shop, kind: best.kind } : null
}

const isLinked = (s: LinkStop, shopIds: Set<string>) => !!s.shopId && shopIds.has(s.shopId)

// Every unlinked stop on these days (no shopId, or one whose shop is gone), with a suggestion.
export function linkSuggestions(days: LinkDay[], shops: LinkShop[]): { day: string; index: number; name: string; suggestion: { shop: LinkShop; kind: 'exact' | 'close' } | null }[] {
  const ids = new Set(shops.map((s) => s._id))
  return days.flatMap((d) => d.stops.flatMap((s, index) => (isLinked(s, ids) ? [] : [{ day: d.day, index, name: String(s.name || ''), suggestion: suggestShop(s.name, shops) }])))
}

// The diagnosis: per stop, linked or not, and the linked shop's area.
export function linkDiagnosis(days: LinkDay[], shops: LinkShop[]): { day: string; name: string; linked: boolean; shopName: string | null; area: string | null; missingShop: boolean }[] {
  const byId = new Map(shops.map((s) => [s._id, s]))
  return days.flatMap((d) => d.stops.map((s) => {
    const shop = s.shopId ? byId.get(s.shopId) : undefined
    return {
      day: d.day,
      name: String(s.name || shop?.shopName || ''),
      linked: !!shop,
      shopName: shop?.shopName ?? null,
      area: shop?.area ?? null,
      missingShop: !!s.shopId && !shop,
    }
  }))
}
