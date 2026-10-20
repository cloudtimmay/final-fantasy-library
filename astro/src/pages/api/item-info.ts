import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import {
  ALBUM_GENRES, ALBUM_FORMATS,
  GAME_PLATFORMS, GAME_GENRES,
  BOOK_GENRES, BOOK_LANGUAGES,
} from '../../lib/collection-fields'

export const prerender = false

// Same web-search judgment call as shop-info.ts (matching search results to the right
// real-world release), same model/budget reasoning.
const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 4096
const TIMEOUT_MS = 40000

const TYPES = ['album', 'game', 'book', 'figure'] as const
type ItemType = (typeof TYPES)[number]

// Per-type prompt instructions and preferred sources, from the investigation this was
// proposed from — the same sources add-item.astro's own "Look up" links already point to.
const TYPE_PROMPT: Record<ItemType, { noun: string; sources: string; fields: string }> = {
  album: {
    noun: 'a Japanese music album/soundtrack',
    sources: 'VGMdb (vgmdb.net) is the best source for these — prefer it when available.',
    fields: `- artist: string, or null.
- composer: string, or null.
- genre: one of ${JSON.stringify(ALBUM_GENRES)}, or null.
- format: one of ${JSON.stringify(ALBUM_FORMATS.map((f) => f.value))} (vinyl_lp, vinyl_single, cd, cassette, digital), or null.
- label: record label, string, or null.
- distributor: string, or null.
- publisher: string, or null.
- catalogNumber: the catalog number printed on the release (e.g. "SQEX-10130"), or null.
- barcode: JAN/EAN barcode, digits only, or null.
- releaseDate: the release date as a string (e.g. "2020-03-20" or just a year), or null.
- releasePrice: the original release price as shown by the source (e.g. "¥3000"), or null.
- vgmdbId: the VGMdb album ID (numeric, from a vgmdb.net URL), or null.
- vgmdbUrl: the album's VGMdb URL, taken from an actual search result, or null.`,
  },
  game: {
    noun: 'a video game',
    sources: 'MobyGames (mobygames.com) and IGDB (igdb.com) are good sources for these.',
    fields: `- genre: one of ${JSON.stringify(GAME_GENRES)}, or null.
- platform: one of ${JSON.stringify(GAME_PLATFORMS)}, or null.
- developer: string, or null.
- publisher: string, or null.
- year: release year, number, or null.
- externalImageUrl: a URL to box art/cover image, taken from an actual search result, or null.`,
  },
  book: {
    noun: 'a book',
    sources: 'Google Books and OpenLibrary (openlibrary.org) are good sources for these.',
    fields: `- genre: one of ${JSON.stringify(BOOK_GENRES)}, or null.
- publisher: string, or null.
- year: publication year, number, or null.
- pages: page count, number, or null.
- language: one of ${JSON.stringify(BOOK_LANGUAGES)}, or null.
- isbn: ISBN-10 or ISBN-13, digits only (no hyphens), or null.
- externalImageUrl: a URL to the cover image, taken from an actual search result, or null.`,
  },
  figure: {
    noun: 'a collectible figure or piece of merchandise',
    sources: 'MyFigureCollection (myfigurecollection.net) is the best source for these.',
    fields: `- manufacturer: string, or null.
- series: the game/anime franchise it's from, string, or null.
- scale: the figure's scale as printed, e.g. "1/7" (null if not a scaled figure — plushies/wearables usually have none).
- year: release year, number, or null.`,
  },
}

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

  const type = body.type as ItemType
  if (!TYPES.includes(type)) return json(400, { error: 'Invalid type' })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return json(400, { error: 'Missing title' })
  const barcode = typeof body.barcode === 'string' ? body.barcode.trim() : ''
  const isbn = typeof body.isbn === 'string' ? body.isbn.trim() : ''
  const creator = typeof body.creator === 'string' ? body.creator.trim() : ''

  const spec = TYPE_PROMPT[type]
  const lines = [`Find information about this ${spec.noun}.`, `Title: ${title}`]
  if (creator) lines.push(`Already-known artist/author/developer: ${creator}`)
  if (barcode) lines.push(`Already-known barcode (JAN/EAN): ${barcode}`)
  if (isbn) lines.push(`Already-known ISBN: ${isbn}`)
  const userPrompt = lines.join('\n')

  const systemPrompt = `You research ${spec.noun} using web search, to help fill in a personal collection database. You have a web_search tool — use it. ${spec.sources}

Search for the specific named release. If you cannot confidently identify the specific release from search results, prefer returning null fields over guessing.

After searching, respond with ONLY a JSON object (no other text, no markdown code fences, no explanation) with exactly these fields:
${spec.fields}

Use null for any field you cannot find reliably via search — never guess or estimate a value from general knowledge alone, and never invent a URL that didn't come from an actual search result.`

  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[item-info] ANTHROPIC_API_KEY set:', !!apiKey)
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
        system: systemPrompt,
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
      console.error('[item-info] upstream error, status:', res.status, 'type:', errType, 'message:', errMessage)
      if (typeof errMessage === 'string' && /web[_ ]?search/i.test(errMessage)) {
        return json(502, { error: 'Web search is not enabled for this Anthropic account. Enable it in the Anthropic Console (Settings → Web search), or ask your organization admin to.' })
      }
      return json(502, { error: `API error: ${errMessage || errType || `HTTP ${res.status}`}` })
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return json(504, { error: 'Lookup timed out — try again' })
    console.error('[item-info] request failed:', e?.message || e)
    return json(502, { error: 'API error: request failed' })
  }

  const content: any[] = Array.isArray(raw?.content) ? raw.content : []

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
    console.error('[item-info] no text block in response, stop_reason:', raw?.stop_reason, 'block types:', content.map((b) => b?.type))
    return json(502, { error: 'Could not read the AI response' })
  }
  if (raw?.stop_reason === 'max_tokens') {
    console.error('[item-info] response was truncated at max_tokens')
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
    console.error('[item-info] could not parse JSON object from model text:', text.slice(0, 500))
    return json(502, { error: 'Could not read the AI response' })
  }

  const str = (v: any, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const num = (v: any): number | null => (typeof v === 'number' && isFinite(v) ? v : null)
  const enumVal = (v: any, allowed: string[]): string | null => (typeof v === 'string' && allowed.includes(v) ? v : null)
  const digits = (v: any, lengths: number[]): string | null => {
    if (typeof v !== 'string') return null
    const d = v.replace(/\D/g, '')
    return lengths.includes(d.length) ? d : null
  }
  // A URL is only trusted if its hostname actually appeared in a search result — never
  // taken from the model's text alone (same anti-hallucination rule as shop-info.ts's
  // `website` field).
  const url = (v: any): string | null => {
    if (typeof v !== 'string' || !v.trim()) return null
    const u = v.trim()
    const hostname = /^https?:\/\//i.test(u) ? hostnameOf(u) : null
    return hostname && seenHostnames.has(hostname) ? u : null
  }

  const result: Record<string, any> = {}

  if (type === 'album') {
    if (str(parsed.artist, 200)) result.artist = str(parsed.artist, 200)
    if (str(parsed.composer, 200)) result.composer = str(parsed.composer, 200)
    if (enumVal(parsed.genre, ALBUM_GENRES)) result.genre = parsed.genre
    if (enumVal(parsed.format, ALBUM_FORMATS.map((f) => f.value))) result.format = parsed.format
    if (str(parsed.label, 200)) result.label = str(parsed.label, 200)
    if (str(parsed.distributor, 200)) result.distributor = str(parsed.distributor, 200)
    if (str(parsed.publisher, 200)) result.publisher = str(parsed.publisher, 200)
    if (str(parsed.catalogNumber, 100)) result.catalogNumber = str(parsed.catalogNumber, 100)
    if (digits(parsed.barcode, [8, 12, 13])) result.barcode = digits(parsed.barcode, [8, 12, 13])
    if (str(parsed.releaseDate, 50)) result.releaseDate = str(parsed.releaseDate, 50)
    if (str(parsed.releasePrice, 50)) result.releasePrice = str(parsed.releasePrice, 50)
    if (str(parsed.vgmdbId, 50)) result.vgmdbId = str(parsed.vgmdbId, 50)
    if (url(parsed.vgmdbUrl)) result.vgmdbUrl = url(parsed.vgmdbUrl)
  } else if (type === 'game') {
    if (enumVal(parsed.genre, GAME_GENRES)) result.genre = parsed.genre
    if (enumVal(parsed.platform, GAME_PLATFORMS)) result.platform = parsed.platform
    if (str(parsed.developer, 200)) result.developer = str(parsed.developer, 200)
    if (str(parsed.publisher, 200)) result.publisher = str(parsed.publisher, 200)
    if (num(parsed.year)) result.year = num(parsed.year)
    if (url(parsed.externalImageUrl)) result.externalImageUrl = url(parsed.externalImageUrl)
  } else if (type === 'book') {
    if (enumVal(parsed.genre, BOOK_GENRES)) result.genre = parsed.genre
    if (str(parsed.publisher, 200)) result.publisher = str(parsed.publisher, 200)
    if (num(parsed.year)) result.year = num(parsed.year)
    if (num(parsed.pages)) result.pages = num(parsed.pages)
    if (enumVal(parsed.language, BOOK_LANGUAGES)) result.language = parsed.language
    if (digits(parsed.isbn, [10, 13])) result.isbn = digits(parsed.isbn, [10, 13])
    if (url(parsed.externalImageUrl)) result.externalImageUrl = url(parsed.externalImageUrl)
  } else if (type === 'figure') {
    if (str(parsed.manufacturer, 200)) result.manufacturer = str(parsed.manufacturer, 200)
    if (str(parsed.series, 200)) result.series = str(parsed.series, 200)
    if (typeof parsed.scale === 'string' && /^\d+\/\d+$/.test(parsed.scale.trim())) result.scale = parsed.scale.trim()
    if (num(parsed.year)) result.year = num(parsed.year)
  }

  return json(200, { ok: true, result, sources })
}
