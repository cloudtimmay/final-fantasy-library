import type { APIRoute } from 'astro'
import { sanity } from '../../lib/sanity'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const GET: APIRoute = async ({ url }) => {
  const barcode = (url.searchParams.get('barcode') || '').trim()
  if (!barcode) return json(400, { error: 'Missing barcode' })

  try {
    const matches = await sanity.fetch(
      `*[_type in ["album","game","book","figure"] && barcode == $barcode && !(_id in path("drafts.**"))]{
        _id, _type, title, status
      }`,
      { barcode }
    )
    return json(200, { ok: true, count: matches.length, matches })
  } catch {
    return json(500, { error: 'Check failed' })
  }
}