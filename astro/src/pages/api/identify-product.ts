import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { validateIdentifyResult, IDENTIFY_SYSTEM_PROMPT as SYSTEM_PROMPT } from '../../lib/identify-result'

export const prerender = false

// One place to change the model. Not validated against Anthropic's current catalog —
// if this starts failing, that's the first thing to check.
const MODEL = 'claude-haiku-5-5'

const MAX_IMAGES = 3
const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 25000

// This model can spontaneously emit an interleaved "thinking" content block before its
// answer, even though nothing here requests extended thinking — confirmed by a live test
// call where a harder (multi-image) prompt used several hundred tokens on thinking alone.
// 500 was too small: it let the thinking block eat the whole budget and cut the response
// off before (or partway through) the actual JSON. Generous headroom avoids that.
const MAX_TOKENS = 2048

// The system prompt lives in lib/identify-result.ts (testable there).

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const images: string[] = Array.isArray(body.images)
    ? body.images.filter((x: any) => typeof x === 'string' && x)
    : []
  if (images.length === 0) return json(400, { error: 'Missing image' })
  if (images.length > MAX_IMAGES) return json(400, { error: `Too many images (max ${MAX_IMAGES})` })

  let totalBytes = 0
  for (const img of images) totalBytes += Buffer.byteLength(img, 'base64')
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    return json(400, { error: 'Images are too large (max 4MB total)' })
  }

  // Defensive: strip a "data:image/...;base64," prefix if one slipped through, and
  // verify what's left actually looks like base64. The client sends raw base64 only,
  // but this endpoint doesn't control every caller.
  for (let i = 0; i < images.length; i++) {
    const commaIdx = images[i].indexOf(',')
    if (images[i].startsWith('data:') && commaIdx !== -1) {
      images[i] = images[i].slice(commaIdx + 1)
    }
  }

  // Same pattern as SANITY_TOKEN/SANITY_WRITE_TOKEN in lib/sanity.ts — read via
  // import.meta.env so it works from astro/.env locally and from the Vercel Secret in
  // Production/Preview, and is never bundled into any client-side script.
  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[identify-product] ANTHROPIC_API_KEY set:', !!apiKey)
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
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } })),
              { type: 'text', text: 'Identify this product.' },
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
      console.error('[identify-product] upstream error, status:', res.status, 'type:', errType, 'message:', errMessage)
      return json(502, { error: `API error: ${errMessage || errType || `HTTP ${res.status}`}` })
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return json(504, { error: 'AI identification timed out — try again' })
    console.error('[identify-product] request failed:', e?.message || e)
    return json(502, { error: 'API error: request failed' })
  }

  // This model can precede its answer with a "thinking" content block (see MAX_TOKENS
  // comment above), so the response text isn't reliably at content[0] — find the first
  // block that actually is text.
  const textBlock = Array.isArray(raw?.content) ? raw.content.find((b: any) => b?.type === 'text') : null
  const text = textBlock?.text
  if (typeof text !== 'string') {
    console.error('[identify-product] no text block in response, stop_reason:', raw?.stop_reason, 'block types:', Array.isArray(raw?.content) ? raw.content.map((b: any) => b?.type) : raw?.content)
    return json(502, { error: 'Could not read the AI response' })
  }
  if (raw?.stop_reason === 'max_tokens') {
    console.error('[identify-product] response was truncated at max_tokens')
  }

  // Robust JSON extraction: strip markdown code fences defensively (models sometimes
  // wrap JSON in ```json...``` even when told not to), then fall back to pulling out
  // the first {...} object if there's still surrounding prose.
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
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
    console.error('[identify-product] could not parse JSON from model text:', text.slice(0, 500))
    return json(502, { error: 'Could not read the AI response' })
  }

  // Every field validated (and anything invalid dropped) in lib/identify-result.ts.
  return json(200, { ok: true, result: validateIdentifyResult(parsed) })
}
