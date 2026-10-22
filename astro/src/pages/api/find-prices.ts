import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { CATEGORIES, CURRENCIES } from '../../lib/price-entry-fields'
import { extractPagePrice, applyPagePrice } from '../../lib/page-price'
import { buildFindPricesSystemPrompt, norwaySearchQueries, NORWAY_MAX_SEARCHES } from '../../lib/find-prices-prompt'
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

const CATEGORY_LABELS: Record<string, string> = {
  album: 'music album',
  game: 'video game',
  book: 'book',
  figure: 'piece of merchandise',
  other: 'item',
}

// System prompt (including the Norwegian store list, grouped by category) lives in
// lib/find-prices-prompt.ts, and result validation in lib/find-prices-results.ts — see those
// files' own comments for why.

// Online searches stay at 5; Norway gets NORWAY_MAX_SEARCHES (6), one per targeted
// "site:" search — more would risk the 55s timeout below (Vercel maxDuration is 60s).
const ONLINE_MAX_SEARCHES = 5

// Each found result is then checked against its own product page (see lib/page-price.ts) —
// the model's price comes from the search index and can be stale. All pages are fetched in
// parallel, each for at most PAGE_FETCH_TIMEOUT_MS, and never past TOTAL_BUDGET_MS from the
// start of the request (Vercel maxDuration is 60s): a page still loading at the deadline is
// left unverified rather than delaying the response.
const PAGE_FETCH_TIMEOUT_MS = 5000
const TOTAL_BUDGET_MS = 58000
const MIN_PAGE_FETCH_MS = 500
const MAX_PAGE_BYTES = 5 * 1024 * 1024
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function fetchPageHtml(url: string, deadline: number): Promise<string | null> {
  const ms = Math.min(PAGE_FETCH_TIMEOUT_MS, deadline - Date.now())
  if (ms < MIN_PAGE_FETCH_MS) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) return null
    if (Number(res.headers.get('content-length') || 0) > MAX_PAGE_BYTES) return null
    const html = await res.text()
    return html.length > MAX_PAGE_BYTES ? null : html
  } catch {
    return null // blocked, timed out, TLS/network error — the result just stays unverified
  } finally {
    clearTimeout(timer)
  }
}

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

  const lines = [`Find current prices for this ${CATEGORY_LABELS[category] || 'product'}.`]
  lines.push(`Product name (English): ${productName}`)
  if (productNameJp) lines.push(`Product name (Japanese): ${productNameJp}`)
  if (jan) lines.push(`JAN/barcode: ${jan}`)
  lines.push(`Region: ${region === 'norway' ? 'Norwegian stores, prices in NOK' : 'international stores that ship to Norway'}`)
  if (region === 'norway') {
    lines.push('Run these searches, in this order:')
    for (const q of norwaySearchQueries(category, { productName, productNameJp, jan })) lines.push(`- ${q}`)
  }
  const userPrompt = lines.join('\n')

  // Same pattern as identify-product.ts / SANITY_TOKEN — read via import.meta.env so it
  // works from astro/.env locally and from the Vercel Secret in Production/Preview, and
  // is never bundled into any client-side script.
  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[find-prices] ANTHROPIC_API_KEY set:', !!apiKey)
  if (!apiKey) return json(500, { error: 'API key missing' })

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
        return json(502, { error: 'Web search is not enabled for this Anthropic account. Enable it in the Anthropic Console (Settings → Web search), or ask your organization admin to.' })
      }
      return json(502, { error: `API error: ${errMessage || errType || `HTTP ${res.status}`}` })
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return json(504, { error: 'Search timed out — try again' })
    console.error('[find-prices] request failed:', e?.message || e)
    return json(502, { error: 'API error: request failed' })
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
    return json(502, { error: 'Could not read the AI response' })
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
    return json(502, { error: 'Could not read the AI response' })
  }

  const { results: found, dropped, candidates } = validateFindPricesResults(parsed, region, seenHostnames)
  if (dropped.length) console.error('[find-prices] dropped candidates:', JSON.stringify(dropped))

  // Only https URLs on a hostname the search actually returned get here (validated above),
  // so this never fetches an address the model made up.
  const deadline = startedAt + TOTAL_BUDGET_MS
  const results = await Promise.all(
    found.map(async (r) => {
      const html = await fetchPageHtml(r.url, deadline)
      const checked = applyPagePrice(r, html ? extractPagePrice(html) : null, region, CURRENCIES)
      if (checked.searchPrice !== undefined) {
        console.error('[find-prices] page price differs from search:', r.url, `${checked.searchPrice} ${checked.searchCurrency} -> ${checked.price} ${checked.currency}`)
      }
      return checked
    })
  )

  return json(200, { ok: true, results, diagnostics: { searches, candidates, dropped } })
}
