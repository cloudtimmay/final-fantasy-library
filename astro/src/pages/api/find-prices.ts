import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { CATEGORIES, CURRENCIES } from '../../lib/price-entry-fields'
import { extractPagePrice, applyPagePrice, extractProductIdentity } from '../../lib/page-price'
import { fetchHtml, lookupNorwayStores, mergeFindPricesResults, checkAiResult } from '../../lib/store-lookup'
import { buildFindPricesSystemPrompt, buildFindPricesUserPrompt, NORWAY_MAX_SEARCHES } from '../../lib/find-prices-prompt'
import { validateFindPricesResults, hostnameOf } from '../../lib/find-prices-results'

export const prerender = false

// One place to change the model. Starting point per instruction — web search involves
// the model judging whether a found listing is actually the same edition/format, which
// is a harder judgement call than identify-product.ts's single-image read; move to a
// larger model if haiku's matches turn out unreliable.
const MODEL = 'claude-haiku-5-5'

// A single search can involve up to 5 tool round-trips, each of which can return several
// results (title/url/snippet per hit) that count toward this same response's output
// tokens, on top of a possible unrequested "thinking" block (see identify-product.ts)
// and the model's own final JSON. Generous headroom avoids truncation mid-search.
const MAX_TOKENS = 8192
const TIMEOUT_MS = 55000

// Same ceiling as identify-product.ts's total image budget, applied here to the single
// optional product photo this endpoint accepts.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

// System and user prompts (including the Norwegian store list, grouped by category) live in
// lib/find-prices-prompt.ts, and result validation in lib/find-prices-results.ts — see those
// files' own comments for why.

// Online searches stay at 5; Norway gets NORWAY_MAX_SEARCHES (8), one per targeted
// "site:" search — more would risk the 55s timeout below (Vercel maxDuration is 60s).
const ONLINE_MAX_SEARCHES = 5

// Each AI result is then checked against its own product page (see lib/page-price.ts) — the
// model's price comes from the search index and can be stale — and for Norway the stores'
// own search pages are looked up directly (see lib/store-lookup.ts), in parallel with the AI
// call from the start of the request. Every page fetch has its own short timeout and none
// runs past TOTAL_BUDGET_MS from the start of the request (Vercel maxDuration is 60s): a page
// still loading at the deadline is left out or left unverified rather than delaying the
// response.
const PAGE_FETCH_TIMEOUT_MS = 5000
const TOTAL_BUDGET_MS = 58000
const MIN_PAGE_FETCH_MS = 500

export const POST: APIRoute = async ({ request }) => {
  const startedAt = Date.now()
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const productName = typeof body.productName === 'string' ? body.productName.trim() : ''
  const productNameJp = typeof body.productNameJp === 'string' ? body.productNameJp.trim() : ''
  const jan = typeof body.jan === 'string' ? body.jan.replace(/\D/g, '') : ''
  const category = typeof body.category === 'string' ? body.category : ''
  const region = body.region === 'norway' || body.region === 'online' ? body.region : ''

  if (!productName) return json(400, { error: 'Missing product name' })
  if (!CATEGORIES.includes(category)) return json(400, { error: 'Missing or invalid category' })
  if (!region) return json(400, { error: 'Missing or invalid region' })

  // Optional product photo — confirms edition/format only, the search itself stays
  // text-based. Defensive prefix-strip for the same reason as identify-product.ts: the
  // client sends raw base64 only, but this endpoint doesn't control every caller.
  let image: string | undefined
  if (typeof body.image === 'string' && body.image) {
    image = body.image
    const commaIdx = image.indexOf(',')
    if (image.startsWith('data:') && commaIdx !== -1) image = image.slice(commaIdx + 1)
    if (Buffer.byteLength(image, 'base64') > MAX_IMAGE_BYTES) {
      return json(400, { error: 'Image is too large (max 4MB)' })
    }
  }

  const userPrompt = buildFindPricesUserPrompt({ category, region, productName, productNameJp, jan })

  // What results are matched against: Norway never uses the Japanese name (not in the AI
  // prompt, the store lookups or the edition check) — Norwegian shops don't list it.
  const matchAgainst = region === 'norway' ? { productName, jan } : { productName, productNameJp, jan }

  // Norway: the stores' own search pages, looked up while the AI searches. Never throws.
  const deadline = startedAt + TOTAL_BUDGET_MS
  const directLookup =
    region === 'norway'
      ? lookupNorwayStores(category, matchAgainst, { deadline })
      : Promise.resolve({ results: [], stores: [] })

  // If the AI call fails but the store lookup found something, return that rather than an
  // error, with the AI failure in the diagnostics.
  const aiFailed = async (status: number, error: string) => {
    const direct = await directLookup
    if (!direct.results.length) return json(status, { error, diagnostics: { searches: 0, candidates: 0, dropped: [], stores: direct.stores } })
    return json(200, {
      ok: true,
      results: mergeFindPricesResults([], direct.results),
      diagnostics: { searches: 0, candidates: 0, dropped: [], stores: direct.stores, aiError: error },
    })
  }

  // Same pattern as identify-product.ts / SANITY_TOKEN — read via import.meta.env so it
  // works from astro/.env locally and from the Vercel Secret in Production/Preview, and
  // is never bundled into any client-side script.
  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[find-prices] ANTHROPIC_API_KEY set:', !!apiKey)
  if (!apiKey) return aiFailed(500, 'API key missing')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let raw: any
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildFindPricesSystemPrompt(category),
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: region === 'norway' ? NORWAY_MAX_SEARCHES : ONLINE_MAX_SEARCHES }],
        messages: [
          {
            role: 'user',
            content: [
              ...(image ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }] : []),
              { type: 'text', text: userPrompt },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      // Never forward the raw upstream response (or anything that could contain the
      // key) to the client — but do log enough server-side to diagnose this.
      let errBody: any = null
      try {
        errBody = await res.json()
      } catch {}
      const errType = errBody?.error?.type
      const errMessage = errBody?.error?.message
      console.error('[find-prices] upstream error, status:', res.status, 'type:', errType, 'message:', errMessage)
      if (typeof errMessage === 'string' && /web[_ ]?search/i.test(errMessage)) {
        return aiFailed(502, 'Web search is not enabled for this Anthropic account. Enable it in the Anthropic Console (Settings → Web search), or ask your organization admin to.')
      }
      return aiFailed(502, `API error: ${errMessage || errType || `HTTP ${res.status}`}`)
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return aiFailed(504, 'Search timed out — try again')
    console.error('[find-prices] request failed:', e?.message || e)
    return aiFailed(502, 'API error: request failed')
  }

  const content: any[] = Array.isArray(raw?.content) ? raw.content : []

  // Every URL Claude actually saw via the tool, across all searches in this response —
  // a found result's url must resolve to one of these hostnames, or it's dropped as a
  // possible invented URL. web_search_tool_result's `content` is either an array of
  // { url, title, ... } hits, or a single error object — only the array case has URLs.
  const seenHostnames = new Set<string>()
  const searches = content.filter((b) => b?.type === 'server_tool_use' && b?.name === 'web_search').length
  for (const block of content) {
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const hit of block.content) {
        const h = typeof hit?.url === 'string' ? hostnameOf(hit.url) : null
        if (h) seenHostnames.add(h)
      }
    }
  }

  // The model can precede (and interleave) its answer with "thinking"/tool blocks (see
  // identify-product.ts), and here the final JSON can legitimately be split across
  // several text blocks around tool calls — concatenate all of them before parsing.
  const textBlocks = content.filter((b) => b?.type === 'text')
  const text = textBlocks.map((b) => b.text).join('\n')
  if (!text.trim()) {
    console.error('[find-prices] no text block in response, stop_reason:', raw?.stop_reason, 'block types:', content.map((b) => b?.type))
    return aiFailed(502, 'Could not read the AI response')
  }
  if (raw?.stop_reason === 'max_tokens') {
    console.error('[find-prices] response was truncated at max_tokens')
  }

  // Robust JSON extraction: strip markdown code fences defensively, then fall back to
  // pulling out the first [...] array if there's still surrounding prose.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {}
    }
  }
  if (!Array.isArray(parsed)) {
    console.error('[find-prices] could not parse JSON array from model text:', text.slice(0, 500))
    return aiFailed(502, 'Could not read the AI response')
  }

  const { results: found, dropped, candidates } = validateFindPricesResults(parsed, region, seenHostnames)
  if (dropped.length) console.error('[find-prices] dropped candidates:', JSON.stringify(dropped))

  // Only https URLs on a hostname the search actually returned get here (validated above),
  // so this never fetches an address the model made up. Prisjakt and Finn pages are never
  // fetched (their terms forbid automated access — see NORWAY_COMPARISON_SITES): those
  // results stay unverified, labelled with their source.
  const checkedAll = await Promise.all(
    found.map(async (r) => {
      if (r.source) return applyPagePrice(r, null, region, CURRENCIES)
      const ms = Math.min(PAGE_FETCH_TIMEOUT_MS, deadline - Date.now())
      const page = ms >= MIN_PAGE_FETCH_MS ? await fetchHtml(r.url, ms) : null
      const result = applyPagePrice(r, page?.ok ? extractPagePrice(page.html) : null, region, CURRENCIES)
      if (result.searchPrice !== undefined) {
        console.error('[find-prices] page price differs from search:', r.url, `${result.searchPrice} ${result.searchCurrency} -> ${result.price} ${result.currency}`)
      }
      // The same page also says which edition it is (lib/edition.ts, store-lookup.ts).
      const edition = checkAiResult(page?.ok ? extractProductIdentity(page.html) : null, matchAgainst)
      if (edition.drop) {
        dropped.push({ store: r.store, reason: edition.drop })
        return null
      }
      return edition.matchedBy ? { ...result, matchedBy: edition.matchedBy } : result
    })
  )
  const checked = checkedAll.filter((r): r is NonNullable<typeof r> => !!r)

  const direct = await directLookup
  const results = mergeFindPricesResults(checked, direct.results)
  return json(200, { ok: true, results, diagnostics: { searches, candidates, dropped, stores: direct.stores } })
}
