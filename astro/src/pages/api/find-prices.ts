import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { CATEGORIES, CURRENCIES } from '../../lib/price-entry-fields'

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

const CATEGORY_LABELS: Record<string, string> = {
  album: 'music album',
  game: 'video game',
  book: 'book',
  figure: 'piece of merchandise',
  other: 'item',
}

const SYSTEM_PROMPT = `You search the web to find current prices for a specific retail product (Final Fantasy and other Square Enix games, music, books, and merchandise from Japan), sold either in Norwegian stores or in international online stores that ship to Norway. You have a web_search tool — use it.

Search strategy: if a JAN/EAN/UPC barcode is given, search by that first — it is the most reliable way to match the exact edition. Otherwise search by product name, trying both the English name and, if given, the Japanese name.

For region "norway": search Norwegian retailers, for example Outland, Platekompaniet, Komplett, Elkjøp, Proshop, and other Norwegian shops. Prices must be in NOK.

For region "online": search international stores that ship to Norway, for example CDJapan, AmiAmi, Play-Asia, Amazon.co.jp, Amazon.com, and Mercari (via a proxy/forwarding service, since Mercari itself does not ship internationally). Prices can be in JPY, USD or EUR depending on the store.

Only include a result if you are confident the product actually matches — same edition, same format (for example, don't match a Blu-ray edition to a request for a DVD, and don't match a different regional release unless that is genuinely what is being sold). If you are unsure whether a found listing is really the same product, leave it out rather than guessing.

After searching, respond with ONLY a JSON array (no other text, no markdown code fences, no explanation) of up to 6 objects, each with exactly these fields:
- store: string, the store/site name.
- price: number, the price shown on the page (do not convert currencies).
- currency: one of "JPY", "NOK", "USD", "EUR" — matching what the page actually shows.
- url: string, the exact product page URL you found via search — never invent or guess a URL.
- inStock: true if clearly in stock, false if clearly out of stock/sold out, null if unclear.
- note: a short string noting anything relevant (e.g. "used", "pre-order", "different edition?"), or null if there is nothing to note.

If you find nothing reliable, respond with an empty JSON array: []`

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

export const POST: APIRoute = async ({ request }) => {
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

  const lines = [`Find current prices for this ${CATEGORY_LABELS[category] || 'product'}.`]
  lines.push(`Product name (English): ${productName}`)
  if (productNameJp) lines.push(`Product name (Japanese): ${productNameJp}`)
  if (jan) lines.push(`JAN/barcode: ${jan}`)
  lines.push(`Region: ${region === 'norway' ? 'Norwegian stores, prices in NOK' : 'international stores that ship to Norway'}`)
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
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
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

  const results: Record<string, any>[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const store = typeof item.store === 'string' ? item.store.trim() : ''
    if (!store) continue
    if (typeof item.price !== 'number' || !isFinite(item.price) || item.price < 0) continue
    if (!CURRENCIES.includes(item.currency)) continue
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (!url.startsWith('https://')) continue
    const hostname = hostnameOf(url)
    if (!hostname || !seenHostnames.has(hostname)) continue

    const inStock = item.inStock === true ? true : item.inStock === false ? false : null
    const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim().slice(0, 200) : undefined

    results.push({ store, price: item.price, currency: item.currency, url, inStock, note })
    if (results.length >= 6) break
  }

  return json(200, { ok: true, results })
}
