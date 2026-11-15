import type { APIRoute } from 'astro'
import { json, parseJsonBody } from '../../lib/api'
import { TRAIN_SCREENSHOT_PROMPT, TRAIN_SCREENSHOTS_NOTE, trainFromModelText } from '../../lib/train-plan'

export const prerender = false

// "🚆 Plan train" → "📷 From screenshots" on the timeline: reads each leg of a route — trains, buses,
// trams … (mode, line, direction, stops, times, platform) — and the walk to the first station from
// up to 3 screenshots, each a tall one cut in readable parts (lib/screenshot-parts.ts), all sent as
// images in one request. Same patterns as identify-product.ts. Nothing is saved here — the page
// shows the result in its form to check first.
//   { images: ["<base64 JPEG>", …] } (or the first version's { image })

// One place to change the model (the same as identify-product.ts).
const MODEL = 'claude-haiku-5-5'
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
// 3 screenshots × up to 4 parts each (lib/screenshot-parts.ts MAX_PARTS); 20 MB in all.
const MAX_IMAGES = 12
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 45000
// Room for a "thinking" block before the answer (see identify-product.ts), and for several legs.
const MAX_TOKENS = 4096

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })
  const list: unknown[] = Array.isArray(body.images) ? body.images : typeof body.image === 'string' ? [body.image] : []
  if (!list.length) return json(400, { error: 'Missing image' })
  if (list.length > MAX_IMAGES) return json(400, { error: `Too many images (max ${MAX_IMAGES})` })
  const images: string[] = []
  let total = 0
  for (const item of list) {
    let image = typeof item === 'string' ? item : ''
    // A "data:image/...;base64," prefix is taken off; the client sends raw base64.
    const comma = image.indexOf(',')
    if (image.startsWith('data:') && comma !== -1) image = image.slice(comma + 1)
    if (!image || !/^[A-Za-z0-9+/=\s]+$/.test(image)) return json(400, { error: 'Missing image' })
    const bytes = Buffer.byteLength(image, 'base64')
    if (bytes > MAX_IMAGE_BYTES) return json(400, { error: 'An image is too large (max 4MB)' })
    total += bytes
    images.push(image)
  }
  if (total > MAX_TOTAL_BYTES) return json(400, { error: 'The screenshots are too large together (max 20MB)' })

  // Read via import.meta.env (astro/.env locally, the Vercel secret in production); never sent
  // to the browser.
  const apiKey = import.meta.env.ANTHROPIC_API_KEY
  console.error('[train-from-screenshot] ANTHROPIC_API_KEY set:', !!apiKey)
  if (!apiKey) return json(500, { error: 'API key missing' })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let raw: any
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: 'user',
          content: [
            ...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
            { type: 'text', text: images.length > 1 ? `${TRAIN_SCREENSHOT_PROMPT}\n\n${TRAIN_SCREENSHOTS_NOTE}` : TRAIN_SCREENSHOT_PROMPT },
          ],
        }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      let errBody: any = null
      try { errBody = await res.json() } catch {}
      console.error('[train-from-screenshot] upstream error, status:', res.status, 'type:', errBody?.error?.type, 'message:', errBody?.error?.message)
      return json(502, { error: `API error: ${errBody?.error?.message || errBody?.error?.type || `HTTP ${res.status}`}` })
    }
    raw = await res.json()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e && e.name === 'AbortError') return json(504, { error: 'Reading the screenshot timed out — try again' })
    console.error('[train-from-screenshot] request failed:', e?.message || e)
    return json(502, { error: 'API error: request failed' })
  }

  // The answer isn't reliably the first content block (a "thinking" block can come first).
  const textBlock = Array.isArray(raw?.content) ? raw.content.find((b: any) => b?.type === 'text') : null
  if (typeof textBlock?.text !== 'string') {
    console.error('[train-from-screenshot] no text block, stop_reason:', raw?.stop_reason)
    return json(502, { error: 'Could not read the AI response' })
  }
  const result = trainFromModelText(textBlock.text)
  if ('error' in result) return json(422, { error: result.error })
  return json(200, { ok: true, train: result.train })
}
