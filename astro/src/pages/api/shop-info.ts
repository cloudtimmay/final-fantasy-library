import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'

export const prerender = false

// One place to change the model. Same reasoning as find-prices.ts — this is a web-search
// judgment call (matching search results to the right real-world shop), not a simple read.
const MODEL = 'claude-haiku-5-5'

// Fewer tool round-trips expected than find-prices.ts (one shop to place, not up to 6
// listings to find), so a smaller budget than that file's 8192/55000 — but still
// generous headroom for an unrequested "thinking" block (see identify-product.ts).
const MAX_TOKENS = 4096
const TIMEOUT_MS = 45000

// Roughly covers Japan (including Okinawa to the south and Hokkaido to the north) —
// anything outside this is certainly wrong, regardless of what the model claims.
const JAPAN_BBOX = { minLat: 24, maxLat: 46, minLng: 122, maxLng: 146 }

// Approximate centers for shopNote's fixed `area` list (sanity/schemaTypes/shopNote.ts) —
// used to sanity-check that a found shop's coordinates are plausibly in the right
// neighborhood, not just somewhere in Japan. "Other" and anything unrecognized skips this
// extra check (falls back to the bounding box alone).
const AREA_CENTERS: Record<string, { lat: number; lng: number }> = {
  Akihabara: { lat: 35.6984, lng: 139.7731 },
  Ikebukuro: { lat: 35.7295, lng: 139.7109 },
  Nakano: { lat: 35.7056, lng: 139.6638 },
  Shinjuku: { lat: 35.6895, lng: 139.6917 },
  Shibuya: { lat: 35.658, lng: 139.7016 },
  Shinagawa: { lat: 35.6284, lng: 139.7387 },
  Yokohama: { lat: 35.4437, lng: 139.638 },
  Osaka: { lat: 34.6937, lng: 135.5023 },
  Kyoto: { lat: 35.0116, lng: 135.7681 },
  'Tokyo Station': { lat: 35.6812, lng: 139.7671 },
  Ginza: { lat: 35.6717, lng: 139.765 },
  Harajuku: { lat: 35.6702, lng: 139.7026 },
  Odawara: { lat: 35.2546, lng: 139.1565 },
  Yoyogi: { lat: 35.6834, lng: 139.7021 },
}
const AREA_PROXIMITY_KM = 30

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Must match itinerary.astro's parseOpeningHours exactly (src/pages/itinerary.astro) — an
// openingHours string that this can't parse is silently treated as "unknown hours" by the
// itinerary page (never an error, just never flags a shop as closed), so an AI-suggested
// string that doesn't fit this is worse than useless there and is dropped here instead.
function parseOpeningHoursRange(text: string): { start: number; end: number } | null {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(String(text || ''))
  if (!m) return null
  const h1 = +m[1], min1 = +m[2], h2 = +m[3], min2 = +m[4]
  if (h1 > 23 || h2 > 23 || min1 > 59 || min2 > 59) return null
  const start = h1 * 60 + min1
  let end = h2 * 60 + min2
  if (end < start) {
    if (end < 360) end += 1440
    else return null
  }
  return { start, end }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

const SYSTEM_PROMPT = `You research real shops and places in Japan using web search, to help fill in a travel-planning note. You have a web_search tool — use it.

Search for the specific named place, using its name together with its area/neighborhood to disambiguate from similarly-named places elsewhere. If you cannot confidently identify the specific place from search results, prefer returning null fields over guessing.

After searching, respond with ONLY a JSON object (no other text, no markdown code fences, no explanation) with exactly these fields:
- openingHours: a short string whose FIRST part is a 24-hour time range in the exact format "HH:MM–HH:MM" (Japan time), optionally followed by notes, e.g. "10:00–20:00, closed Tue". Null if not confidently found.
- address: the physical address in Japan, as a single string. Null if not found.
- latitude: number (decimal degrees). Null if not found.
- longitude: number (decimal degrees). Null if not found.
- taxFreeShop: true only if you find a clear statement the shop offers tax-free/duty-free shopping for tourists, false only if clearly stated it does not, null if unclear or not mentioned anywhere.
- website: the shop's own official website or store page URL, taken from an actual search result — never invent or guess a URL. Null if none found.
- note: one short sentence of useful context (e.g. what the shop is known for), or null if there's nothing notable.

Use null for any field you cannot find reliably via search — never guess or estimate coordinates, hours, or a website from general knowledge alone.`

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const shopName = typeof body.shopName === 'string' ? body.shopName.trim() : ''
  if (!shopName) return json(400, { error: 'Missing shop name' })
  const area = typeof body.area === 'string' ? body.area.trim() : ''
  const currentAddress = typeof body.address === 'string' ? body.address.trim() : ''
  const currentOpeningHours = typeof body.openingHours === 'string' ? body.openingHours.trim() : ''

  const lines = [`Find information about this shop/place in Japan.`, `Name: ${shopName}`]
  if (area) lines.push(`Area/neighborhood: ${area}`)
  if (currentAddress) lines.push(`Already-known address (verify/correct if you find better info): ${currentAddress}`)
  if (currentOpeningHours) lines.push(`Already-known opening hours (verify/correct if you find better info): ${currentOpeningHours}`)
  const userPrompt = lines.join('\n')

  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[shop-info] ANTHROPIC_API_KEY set:', !!apiKey)
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
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      let errBody: any = null
      try {
        errBody = await res.json()
      } catch {}
      const errType = errBody?.error?.type
      const errMessage = errBody?.error?.message
      console.error('[shop-info] upstream error, status:', res.status, 'type:', errType, 'message:', errMessage)
      if (typeof errMessage === 'string' && /web[_ ]?search/i.test(errMessage)) {
        return json(502, { error: 'Web search is not enabled for this Anthropic account. Enable it in the Anthropic Console (Settings → Web search), or ask your organization admin to.' })
      }
      return json(502, { error: `API error: ${errMessage || errType || `HTTP ${res.status}`}` })
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return json(504, { error: 'Lookup timed out — try again' })
    console.error('[shop-info] request failed:', e?.message || e)
    return json(502, { error: 'API error: request failed' })
  }

  const content: any[] = Array.isArray(raw?.content) ? raw.content : []

  // Every URL Claude actually saw via the tool — a website in the model's answer must
  // resolve to one of these hostnames, or it's dropped as a possible invented URL.
  const seenHostnames = new Set<string>()
  const sources: { title: string; url: string }[] = []
  const seenSourceUrls = new Set<string>()
  for (const block of content) {
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const hit of block.content) {
        const h = typeof hit?.url === 'string' ? hostnameOf(hit.url) : null
        if (h) seenHostnames.add(h)
        if (typeof hit?.url === 'string' && !seenSourceUrls.has(hit.url) && sources.length < 5) {
          seenSourceUrls.add(hit.url)
          sources.push({ title: typeof hit.title === 'string' && hit.title.trim() ? hit.title.trim() : hit.url, url: hit.url })
        }
      }
    }
  }

  const textBlocks = content.filter((b) => b?.type === 'text')
  const text = textBlocks.map((b) => b.text).join('\n')
  if (!text.trim()) {
    console.error('[shop-info] no text block in response, stop_reason:', raw?.stop_reason, 'block types:', content.map((b) => b?.type))
    return json(502, { error: 'Could not read the AI response' })
  }
  if (raw?.stop_reason === 'max_tokens') {
    console.error('[shop-info] response was truncated at max_tokens')
  }

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {}
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    console.error('[shop-info] could not parse JSON object from model text:', text.slice(0, 500))
    return json(502, { error: 'Could not read the AI response' })
  }

  let openingHours: string | null =
    typeof parsed.openingHours === 'string' && parsed.openingHours.trim() ? parsed.openingHours.trim().slice(0, 200) : null
  if (openingHours && !parseOpeningHoursRange(openingHours)) openingHours = null

  const address: string | null =
    typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim().slice(0, 200) : null

  let latitude: number | null = typeof parsed.latitude === 'number' && isFinite(parsed.latitude) ? parsed.latitude : null
  let longitude: number | null = typeof parsed.longitude === 'number' && isFinite(parsed.longitude) ? parsed.longitude : null
  if (latitude != null && longitude != null) {
    const inBbox =
      latitude >= JAPAN_BBOX.minLat && latitude <= JAPAN_BBOX.maxLat && longitude >= JAPAN_BBOX.minLng && longitude <= JAPAN_BBOX.maxLng
    const center = AREA_CENTERS[area]
    const nearArea = !center || haversineKm({ lat: latitude, lng: longitude }, center) <= AREA_PROXIMITY_KM
    if (!inBbox || !nearArea) {
      latitude = null
      longitude = null
    }
  } else {
    latitude = null
    longitude = null
  }

  const taxFreeShop: boolean | null = parsed.taxFreeShop === true ? true : parsed.taxFreeShop === false ? false : null

  let website: string | null = null
  if (typeof parsed.website === 'string' && parsed.website.trim()) {
    const url = parsed.website.trim()
    const hostname = /^https?:\/\//i.test(url) ? hostnameOf(url) : null
    if (hostname && seenHostnames.has(hostname)) website = url
  }

  const note: string | null = typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim().slice(0, 300) : null

  return json(200, {
    ok: true,
    result: { openingHours, address, latitude, longitude, taxFreeShop, website, note },
    sources,
  })
}
