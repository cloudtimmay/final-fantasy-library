import type { APIRoute } from 'astro'
import { json } from '../../lib/api'
import { searchPlaces, OSM_ATTRIBUTION } from '../../lib/place-search'

export const prerender = false

// Place search (lib/place-search.ts): OpenStreetMap Nominatim, biased to Japan — never Google
// Places. One request a second at most and a short cache, as Nominatim's usage policy asks; the
// results carry "© OpenStreetMap contributors". GET ?q=<name or address>.
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') || '').trim()
  if (q.length < 2) return json(400, { error: 'Type at least 2 characters' })
  if (q.length > 200) return json(400, { error: 'Too long' })
  try {
    const results = await searchPlaces(q, { fetch })
    return json(200, { ok: true, results, attribution: OSM_ATTRIBUTION })
  } catch (e: any) {
    console.error('[place-search] failed:', e?.message || e)
    return json(502, { error: 'The place search failed — try again.' })
  }
}
