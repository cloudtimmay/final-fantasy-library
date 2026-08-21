import type { APIRoute } from 'astro'
import { sanity } from '../../lib/sanity'
import { json } from '../../lib/api'

export const prerender = false

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