import { test, expect, testName } from './fixtures'

test.describe('api/family-purchase-status', () => {
  test('updates the status of a familyPurchase', async ({ request, sanity, trackDoc }) => {
    const fp = await sanity.create({
      _type: 'familyPurchase',
      name: testName(`FP Status ${Date.now()}`),
      person: 'Tone',
      status: 'planned',
    })
    trackDoc(fp._id)

    const res = await request.post('/api/family-purchase-status', { data: { id: fp._id, status: 'bought' } })
    expect(res.status()).toBe(200)

    const after = await sanity.fetch<{ status: string }>('*[_id == $id][0]{ status }', { id: fp._id })
    expect(after.status).toBe('bought')
  })

  test('rejects a document that is not a familyPurchase, and leaves it unchanged', async ({
    request,
    sanity,
    trackDoc,
  }) => {
    const album = await sanity.create({
      _type: 'album',
      title: testName(`Not An FP ${Date.now()}`),
      status: 'wishlist',
    })
    trackDoc(album._id)

    const res = await request.post('/api/family-purchase-status', { data: { id: album._id, status: 'bought' } })
    expect(res.status()).toBe(400)

    const after = await sanity.fetch<{ _rev: string; status: string }>('*[_id == $id][0]{ _rev, status }', {
      id: album._id,
    })
    expect(after._rev).toBe(album._rev)
    expect(after.status).toBe('wishlist')
  })

  test('returns 404 for an id that does not exist', async ({ request }) => {
    const res = await request.post('/api/family-purchase-status', {
      data: { id: `does-not-exist-${Date.now()}`, status: 'bought' },
    })
    expect(res.status()).toBe(404)
  })
})
