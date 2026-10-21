import { test, expect, testName } from './fixtures'

test.describe('api/shop-coords: save', () => {
  test('saves coordinates on a shopNote', async ({ request, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Coords Shop ${Date.now()}`) })
    trackDoc(shop._id)

    const res = await request.post('/api/shop-coords', { data: { id: shop._id, latitude: 35.6812, longitude: 139.7671 } })
    expect(res.status()).toBe(200)

    const after = await sanity.fetch<{ latitude: number; longitude: number }>(
      '*[_id == $id][0]{ latitude, longitude }',
      { id: shop._id }
    )
    expect(after.latitude).toBe(35.6812)
    expect(after.longitude).toBe(139.7671)
  })

  test('rejects a document that is not a shopNote, and leaves it unchanged', async ({ request, sanity, trackDoc }) => {
    const album = await sanity.create({ _type: 'album', title: testName(`Not A Shop ${Date.now()}`), status: 'wishlist' })
    trackDoc(album._id)

    const res = await request.post('/api/shop-coords', { data: { id: album._id, latitude: 35.6812, longitude: 139.7671 } })
    expect(res.status()).toBe(400)

    // GROQ projects a field that isn't on the document as null.
    const after = await sanity.fetch<{ _rev: string; latitude: number | null; longitude: number | null }>(
      '*[_id == $id][0]{ _rev, latitude, longitude }',
      { id: album._id }
    )
    expect(after._rev).toBe(album._rev)
    expect(after.latitude).toBeNull()
    expect(after.longitude).toBeNull()
  })

  test('returns 404 for an id that does not exist', async ({ request }) => {
    const res = await request.post('/api/shop-coords', {
      data: { id: `does-not-exist-${Date.now()}`, latitude: 35.6812, longitude: 139.7671 },
    })
    expect(res.status()).toBe(404)
  })
})
