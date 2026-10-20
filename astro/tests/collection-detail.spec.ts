import { test, expect, testName } from './fixtures'

test.describe('collection detail pages: needsInfo banner', () => {
  test('album detail page shows a needsInfo banner with the barcode when flagged', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Needs Info Album ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, needsInfo: true, barcode: '4988601234567', status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await expect(page.locator('.needsinfo-banner')).toBeVisible()
    await expect(page.locator('.needsinfo-banner')).toContainText('4988601234567')
  })

  test('album detail page shows no banner when needsInfo is not set', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Complete Album ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await expect(page.locator('.needsinfo-banner')).toHaveCount(0)
  })
})
