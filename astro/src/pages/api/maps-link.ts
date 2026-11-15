import type { APIRoute } from 'astro'
import { json } from '../../lib/api'
import { isGoogleMapsUrl, isShortMapsLink, parseGoogleMapsUrl, resolveMapsLink, mapsLinkPlace } from '../../lib/google-maps-link'

export const prerender = false

// A Google Maps link pasted in a place search (lib/google-maps-link.ts): its coordinates and place
// name, read from the URL. A share link (maps.app.goo.gl/…) is followed only to read where it
// redirects (the Location header — no page body, no Google API). GET ?url=<link>.
export const GET: APIRoute = async ({ url }) => {
  const link = (url.searchParams.get('url') || '').trim()
  if (!link || link.length > 2000 || !isGoogleMapsUrl(link)) return json(400, { error: 'Not a Google Maps link' })
  try {
    const full = isShortMapsLink(link) ? await resolveMapsLink(link, fetch) : link
    const place = full ? parseGoogleMapsUrl(full) : null
    if (!place) return json(422, { error: 'Could not read a place from that link — open it in Google Maps and share the place itself.' })
    return json(200, { ok: true, result: mapsLinkPlace(place) })
  } catch (e: any) {
    console.error('[maps-link] failed:', e?.message || e)
    return json(502, { error: 'Could not open that link — try again.' })
  }
}
