// "💚 Picks": products photographed in shops (price entries still Considering, with a photo)
// that someone at home chooses to buy or skip (priceEntry.pick / pickedBy / pickedAt /
// pickNote — saved by /api/price-pick, the name from the Cloudflare Access login). Pure
// functions plus the GROQ projection /picks fetches with.

export const PICKS = ['buy', 'skip'] as const
export type PickChoice = (typeof PICKS)[number]
export const isPick = (v: unknown): v is PickChoice => typeof v === 'string' && (PICKS as readonly string[]).includes(v)
export const PICK_NOTE_MAX = 200

export const PICKS_QUERY = `
  *[_type == "priceEntry" && !(_id in path("drafts.**")) && status == "considering" && defined(image.asset)] {
    _id, productName, price, currency, seenAt, _createdAt, note,
    "imageUrl": image.asset->url,
    "shopId": shop._ref, "shopName": shop->shopName, "area": shop->area,
    sourceType, sourceName,
    pick, pickedBy, pickedAt, pickNote, hiddenFromPicks
  }`

export type PickDoc = {
  _id: string
  productName?: string | null
  price?: number | null
  currency?: string | null
  seenAt?: string | null
  _createdAt?: string | null
  note?: string | null
  imageUrl?: string | null
  shopId?: string | null
  shopName?: string | null
  area?: string | null
  sourceType?: string | null
  sourceName?: string | null
  pick?: string | null
  pickedBy?: string | null
  pickedAt?: string | null
  pickNote?: string | null
  hiddenFromPicks?: boolean | null
}

export type PickItem = {
  id: string
  name: string
  imageUrl: string
  price: number | null
  currency: string
  seen: string // when it was seen (else when it was logged), ISO
  note: string
  pick: PickChoice | null
  pickedBy: string
  pickedAt: string
  pickNote: string
  hidden: boolean // "🎁 Hide from Picks" (a present): only the owner gets these at all
}
export type PickGroup = { key: string; shopName: string; area: string; items: PickItem[] }

// By shop (a price without a shop under its store/site name, else "Other"), each newest
// first; the shop seen most recently first. Items hidden from Picks only with `includeHidden`
// (the owner).
export function groupPicksByShop(docs: PickDoc[], opts: { includeHidden?: boolean } = {}): PickGroup[] {
  const groups = new Map<string, PickGroup>()
  for (const d of docs) {
    const name = String(d.productName || '').trim()
    if (!name || !d.imageUrl) continue
    if (d.hiddenFromPicks === true && !opts.includeHidden) continue
    const key = d.shopId ? `shop:${d.shopId}` : `source:${(d.sourceName || '').trim().toLowerCase() || 'other'}`
    let g = groups.get(key)
    if (!g) {
      g = { key, shopName: d.shopId ? d.shopName || 'Shop' : (d.sourceName || '').trim() || 'Other', area: d.shopId ? d.area || '' : '', items: [] }
      groups.set(key, g)
    }
    g.items.push({
      id: d._id,
      name,
      imageUrl: d.imageUrl,
      price: typeof d.price === 'number' ? d.price : null,
      currency: d.currency || 'JPY',
      seen: d.seenAt || d._createdAt || '',
      note: (d.note || '').trim(),
      pick: isPick(d.pick) ? d.pick : null,
      pickedBy: d.pickedBy || '',
      pickedAt: d.pickedAt || '',
      pickNote: d.pickNote || '',
      hidden: d.hiddenFromPicks === true,
    })
  }
  const list = [...groups.values()]
  for (const g of list) g.items.sort((a, b) => b.seen.localeCompare(a.seen))
  return list.sort((a, b) => (b.items[0]?.seen || '').localeCompare(a.items[0]?.seen || ''))
}

// "💚 picked by Tone, 10 Nov 14:32" / "👎 skipped by Tone, …" — '' without a pick. The time in
// `timeZone` (the browser's own when not given).
export function pickedText(pick: PickChoice | null, by: string, at: string, timeZone?: string): string {
  if (!pick) return ''
  const d = at ? new Date(at) : null
  const when = d && !isNaN(d.getTime())
    ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) })
    : ''
  return `${pick === 'buy' ? '💚 picked' : '👎 skipped'} by ${by || 'someone'}${when ? `, ${when}` : ''}`
}

// "New since last visit" (per browser): seen after the last visit, or picked after it by
// someone else (your own picks aren't news to you). Nothing is new on a first visit.
export function isNewSince(item: Pick<PickItem, 'seen' | 'pick' | 'pickedAt' | 'pickedBy'>, lastVisit: string | null, me: string): boolean {
  if (!lastVisit) return false
  if (item.seen && item.seen > lastVisit) return true
  return !!item.pick && !!item.pickedAt && item.pickedAt > lastVisit && item.pickedBy !== me
}

// The filter: All / Buy / Skip / Not decided.
export const PICK_FILTERS = ['all', 'buy', 'skip', 'none'] as const
export type PickFilter = (typeof PICK_FILTERS)[number]
export function matchesPickFilter(pick: PickChoice | null, filter: PickFilter): boolean {
  return filter === 'all' || (filter === 'none' ? !pick : pick === filter)
}

// The search: an item whose own name or shop's name contains the words (any case, in any order).
export function matchesPickSearch(itemName: string, shopName: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${itemName} ${shopName}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

// A shop's collapsed header: "Animate · Akihabara · 5 items · 💚 2 · 3 new" — the counts of
// what the filter and search show; 💚 and "new" only when there are any.
export function pickGroupHeader(g: { shopName: string; area: string; items: number; buys: number; fresh: number }): string {
  return [
    g.shopName,
    g.area,
    `${g.items} item${g.items === 1 ? '' : 's'}`,
    g.buys ? `💚 ${g.buys}` : '',
    g.fresh ? `${g.fresh} new` : '',
  ].filter(Boolean).join(' · ')
}
