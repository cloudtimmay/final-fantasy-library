import type { APIRoute } from 'astro'
import { sanityWrite } from '../../lib/sanity'
import { json, parseJsonBody, buildPatch } from '../../lib/api'
import { BOOK_GENRES, BOOK_LANGUAGES, BOOK_READ_STATUSES } from '../../lib/collection-fields'

export const prerender = false

const READ_STATUS_VALUES = BOOK_READ_STATUSES.map((s) => s.value)
const STATUSES = ['owned', 'wishlist', 'sold', 'lent']

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody(request)
  if (!body) return json(400, { error: 'Bad request' })

  const id = String(body.id || '').trim()
  if (!id) return json(400, { error: 'Missing id' })

  const title = String(body.title || '').trim()
  if (!title) return json(400, { error: 'Title is required' })

  const author = String(body.author || '').trim()
  if (!author) return json(400, { error: 'Author is required' })

  const { set, unset } = buildPatch(body, [
    { from: 'publisher' },
    { from: 'year', type: 'num' },
    { from: 'pages', type: 'num' },
    { from: 'isbn' },
    { from: 'genre', type: 'enum', values: BOOK_GENRES },
    { from: 'language', type: 'enum', values: BOOK_LANGUAGES },
    { from: 'readStatus', type: 'enum', values: READ_STATUS_VALUES },
    { from: 'readDate' },
    { from: 'status', type: 'enum', values: STATUSES },
    { from: 'acquiredDate' },
    { from: 'purchasePriceYen', type: 'num' },
    { from: 'purchasePrice', type: 'num' },
    { from: 'notes' },
  ])
  set.title = title
  set.author = author
  set.needsInfo = body.needsInfo === true

  try {
    const existing = await sanityWrite.fetch(`*[_id == $id][0]{ _type }`, { id })
    if (!existing || existing._type !== 'book') return json(400, { error: 'Not a book' })

    let tx = sanityWrite.patch(id).set(set)
    if (unset.length) tx = tx.unset(unset)
    const patched = await tx.commit()
    return json(200, { ok: true, id: patched._id })
  } catch {
    return json(500, { error: 'Update failed' })
  }
}
