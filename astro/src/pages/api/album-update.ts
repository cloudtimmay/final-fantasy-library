import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildPatch } from '../../lib/api'
import { ALBUM_GENRES, ALBUM_FORMATS } from '../../lib/collection-fields'

export const prerender = false

const FORMAT_VALUES = ALBUM_FORMATS.map((f) => f.value)
const STATUSES = ['owned', 'wishlist', 'sold', 'lent']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  // Tracklist is Studio-only — intentionally not accepted here.
  const { set, unset } = buildPatch(body, [
    { from: 'artist' },
    { from: 'composer' },
    { from: 'series' },
    { from: 'genre', type: 'enum', values: ALBUM_GENRES },
    { from: 'format', type: 'enum', values: FORMAT_VALUES },
    { from: 'catalogNumber' },
    { from: 'barcode' },
    { from: 'label' },
    { from: 'distributor' },
    { from: 'publisher' },
    { from: 'releaseDate' },
    { from: 'releasePrice' },
    { from: 'vgmdbId' },
    { from: 'vgmdbUrl' },
    { from: 'youtubeMusicUrl' },
    { from: 'youtubePlaylistId' },
    { from: 'status', type: 'enum', values: STATUSES },
    { from: 'acquiredDate' },
    { from: 'purchasePriceYen', type: 'num' },
    { from: 'purchasePrice', type: 'num' },
    { from: 'notes' },
  ])
  set.title = title
  set.needsInfo = body.needsInfo === true

  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing || existing._type !== 'album') return json(400, { error: 'Not an album' })

    let tx = sanityWrite.patch(id).set(set)
    if (unset.length) tx = tx.unset(unset)
    const patched = await tx.commit()
    return json(200, { ok: true, id: patched._id })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
