import { test, expect, testName } from './fixtures'

test.describe('wishlist: detail links', () => {
  test('links merchandise to /merchandise/<id>, and other types to their own route', async ({
    page,
    sanity,
    trackDoc,
  }) => {
    const figureTitle = testName(`Wishlist Figure ${Date.now()}`)
    const figure = await sanity.create({ _type: 'figure', title: figureTitle, status: 'wishlist' })
    trackDoc(figure._id)
    const albumTitle = testName(`Wishlist Album ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title: albumTitle, status: 'wishlist' })
    trackDoc(album._id)

    await page.goto('/wishlist')

    const figureLink = page.locator('a.wish-row', { hasText: figureTitle })
    await expect(figureLink).toHaveAttribute('href', `/merchandise/${figure._id}`)
    await expect(page.locator('a.wish-row', { hasText: albumTitle })).toHaveAttribute('href', `/albums/${album._id}`)

    const res = await page.request.get(`/merchandise/${figure._id}`)
    expect(res.status()).toBe(200)
  })
})
