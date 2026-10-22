// Validation of /api/find-prices' model output, with a reason recorded for every candidate
// that's dropped — pulled out of find-prices.ts (which can't be imported in a test, see
// find-prices-prompt.ts) so it can be tested directly, and so /add-price can show WHY a
// search came back empty instead of just "No reliable prices found".
import { CURRENCIES } from './price-entry-fields'

export type FoundPrice = {
  store: string
  price: number
  currency: string
  url: string
  inStock: boolean | null
  note?: string
}

export type DroppedCandidate = { store: string; reason: string }

// One Norwegian store's direct lookup (lib/store-lookup.ts): how many matches it gave, or why
// it was skipped (blocked, timed out, layout not recognized, ...).
export type StoreOutcome = { store: string; found: number; reason?: string }

export type FindPricesDiagnostics = {
  searches: number // web searches the model actually ran
  candidates: number // listings it reported, kept or not
  dropped: DroppedCandidate[]
  stores?: StoreOutcome[] // Norway only
  aiError?: string // the AI search failed, but the direct store lookup still found something
}

const MAX_RESULTS = 6

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

// `seenHostnames` is every hostname the web_search tool actually returned — a result's URL
// must be on one of them, or it's dropped as a possibly invented URL.
export function validateFindPricesResults(
  parsed: unknown[],
  region: string,
  seenHostnames: Set<string>
): { results: FoundPrice[]; dropped: DroppedCandidate[]; candidates: number } {
  const results: FoundPrice[] = []
  const dropped: DroppedCandidate[] = []
  let candidates = 0

  for (const item of parsed as any[]) {
    if (!item || typeof item !== 'object') continue
    candidates++
    const store = typeof item.store === 'string' && item.store.trim() ? item.store.trim() : '(unnamed store)'
    const drop = (reason: string) => dropped.push({ store, reason })

    // The model's own edition/product check — it reports what it found but chose not to use.
    if (typeof item.rejected === 'string' && item.rejected.trim()) { drop(`not a match: ${item.rejected.trim().slice(0, 80)}`); continue }
    if (store === '(unnamed store)') { drop('no store name'); continue }
    if (typeof item.price !== 'number' || !isFinite(item.price) || item.price < 0) { drop('no price'); continue }
    if (!CURRENCIES.includes(item.currency)) { drop(`unsupported currency ${String(item.currency)}`); continue }
    // The prompt tells the model Norway prices must be in NOK — enforced here too, rather
    // than just trusted, since a geo-converted display price on a non-Norwegian page could
    // otherwise slip through labeled with the wrong store/currency pairing.
    if (region === 'norway' && item.currency !== 'NOK') { drop(`price in ${item.currency}, not NOK`); continue }
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (!url.startsWith('https://')) { drop('no https link'); continue }
    const hostname = hostnameOf(url)
    if (!hostname || !seenHostnames.has(hostname)) { drop('link not from the search results'); continue }
    if (results.length >= MAX_RESULTS) continue

    const inStock = item.inStock === true ? true : item.inStock === false ? false : null
    const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim().slice(0, 200) : undefined
    results.push({ store, price: item.price, currency: item.currency, url, inStock, note })
  }

  return { results, dropped, candidates }
}

// The AI search part only, e.g. "6 searches, 2 candidates found, 2 dropped: Proshop (price in
// EUR, not NOK), Komplett (another edition (not the illustrated edition))".
export function describeFindPricesDiagnostics(d: FindPricesDiagnostics): string {
  if (d.aiError) return `AI search failed: ${d.aiError}.`
  if (d.searches === 0) return 'The AI did not run any web search.'
  const searches = d.searches === 1 ? '1 search' : `${d.searches} searches`
  const candidates = `${d.candidates} candidate${d.candidates === 1 ? '' : 's'} found`
  if (d.dropped.length === 0) return `${searches}, ${candidates}.`
  const reasons = d.dropped.map((x) => `${x.store} (${x.reason})`).join(', ')
  return `${searches}, ${candidates}, ${d.dropped.length} dropped: ${reasons}`
}

// What a store's direct lookup came to, for the diagnostic lines:
// - blocked: the store refuses server requests (HTTP 403/429 — Ark, Elkjøp, Proshop, CDON,
//   and Norli's key step from Vercel's datacenter IPs), or its page wasn't recognized —
//   either way, check it by hand.
// - temporary: timed out, network error, out of time, a 5xx — may work next time.
// - found / no-match: the store was searched.
export type StoreStatus = 'found' | 'no-match' | 'blocked' | 'temporary'
export function classifyStoreOutcome(o: StoreOutcome): StoreStatus {
  if (!o.reason) return o.found > 0 ? 'found' : 'no-match'
  if (/timed out|network error|out of time|HTTP 5\d\d/i.test(o.reason)) return 'temporary'
  return 'blocked'
}

export type DiagnosticSummary = {
  lines: string[] // short, always shown
  details: string[] // behind a "Details" toggle, one paragraph each; empty = no toggle
  priorityStores: string[] // their "Search on <store>" buttons go first
}

// e.g. lines: "Checked: Outland (3), Power (no match), Cappelen Damm (no match)",
// "Check manually: Ark, Norli, Elkjøp, Proshop, CDON", "Temporary problem: Komplett (timed
// out)"; details: the AI search's counts and dropped candidates, and why stores were blocked.
// `omitAi`: the AI search failed and its error is already shown (the request itself failed) —
// leave out the AI line and the AI details, which would only say it ran no searches.
export function summarizeDiagnostics(d: FindPricesDiagnostics, opts: { omitAi?: boolean } = {}): DiagnosticSummary {
  if (opts.omitAi) d = { ...d, aiError: undefined }
  const stores = d.stores || []
  const by = (s: StoreStatus) => stores.filter((o) => classifyStoreOutcome(o) === s)
  const checked = stores.filter((o) => ['found', 'no-match'].includes(classifyStoreOutcome(o)))
  const blocked = by('blocked')
  const temporary = by('temporary')

  const lines: string[] = []
  if (d.aiError) lines.push(`AI search failed: ${d.aiError}`)
  if (checked.length) lines.push('Checked: ' + checked.map((o) => `${o.store} (${o.found || 'no match'})`).join(', '))
  if (blocked.length) lines.push('Check manually: ' + blocked.map((o) => o.store).join(', '))
  if (temporary.length) lines.push('Temporary problem: ' + temporary.map((o) => `${o.store} (${o.reason})`).join(', '))

  const detailParts: string[] = []
  if (!d.aiError && !opts.omitAi) detailParts.push('AI search: ' + describeFindPricesDiagnostics(d))
  if (blocked.length) detailParts.push('Not searchable from the server: ' + blocked.map((o) => `${o.store} (${o.reason})`).join(', ') + '.')
  // No direct store lookup (an Online search): the AI summary is all there is — show it.
  if (!stores.length && !d.aiError) return { lines: [describeFindPricesDiagnostics(d)], details: [], priorityStores: [] }

  return { lines, details: detailParts, priorityStores: [...blocked, ...temporary].map((o) => o.store) }
}
