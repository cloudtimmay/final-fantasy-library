import path from 'node:path'
import { test, expect } from './fixtures'
import { mockIdentifyCustomResult } from './helpers/mock-ai'

const ALBUM_PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')

async function mockCheckDuplicate(page: import('@playwright/test').Page, count: number, match?: { title: string; status?: string; _type?: string }) {
  await page.route('**/api/check-duplicate*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count, matches: match ? [match] : [] }),
    })
  })
}

test.describe('add-item: AI identify', () => {
  test('taking a photo reveals Identify, and "Use suggestion" fills only the fields with a value', async ({ page }) => {
    await mockCheckDuplicate(page, 0)
    await mockIdentifyCustomResult(page, {
      productName: 'Final Fantasy VII Remake',
      jan: '4988601234567',
      category: 'game',
      price: 5980,
    })

    await page.goto('/add-item')
    await expect(page.locator('#f-identify-btn')).toBeHidden()

    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await expect(page.locator('#f-identify-btn')).toBeVisible()
    await page.locator('#f-identify-btn').click()

    await expect(page.locator('#f-identify-card')).toBeVisible()
    await expect(page.locator('#f-identify-card')).toContainText('Final Fantasy VII Remake')
    await expect(page.locator('#f-identify-card')).toContainText('4988601234567')

    await page.locator('.idf-identify-use-btn').click()
    await expect(page.locator('#f-identify-card')).toBeHidden()

    // category "game" maps the type to "game"
    await expect(page.locator('#f-type')).toHaveValue('game')
    await expect(page.locator('#f-title')).toHaveValue('Final Fantasy VII Remake')
    await expect(page.locator('#f-barcode')).toHaveValue('4988601234567')
    await expect(page.locator('#f-yen')).toHaveValue('5980')
    // No productNameJp/notes in the mocked result — nothing to fill, nothing crashes.
  })

  test('category "figure" maps the type to Merch and defaults the merch category to Figure', async ({ page }) => {
    await mockCheckDuplicate(page, 0)
    await mockIdentifyCustomResult(page, { productName: 'Nendoroid Cloud', category: 'figure' })

    await page.goto('/add-item')
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#f-identify-btn').click()
    await expect(page.locator('#f-identify-card')).toBeVisible()
    await page.locator('.idf-identify-use-btn').click()

    await expect(page.locator('#f-type')).toHaveValue('merch')
    await expect(page.locator('#f-category')).toHaveValue('figure')
    await expect(page.locator('#f-title')).toHaveValue('Nendoroid Cloud')
  })

  test('a JAN from the suggestion still triggers the existing barcode duplicate check', async ({ page }) => {
    await mockCheckDuplicate(page, 1, { title: 'Final Fantasy VII Remake', status: 'owned', _type: 'game' })
    await mockIdentifyCustomResult(page, { productName: 'Final Fantasy VII Remake', jan: '4988601234567', category: 'game' })

    await page.goto('/add-item')
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#f-identify-btn').click()
    await expect(page.locator('#f-identify-card')).toBeVisible()
    await page.locator('.idf-identify-use-btn').click()

    await expect(page.locator('#f-dup')).toBeVisible()
    await expect(page.locator('#f-dup')).toContainText('Already in your collection')
    await expect(page.locator('#f-dup')).toContainText('Final Fantasy VII Remake')
  })

  test('an extra photo is included in the Identify call', async ({ page }) => {
    await mockCheckDuplicate(page, 0)
    let lastImageCount = 0
    await page.route('**/api/identify-product', async (route) => {
      const body = route.request().postDataJSON() as { images: string[] }
      lastImageCount = body.images.length
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { productName: 'Test Item', category: 'book' } }),
      })
    })

    await page.goto('/add-item')
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await expect(page.locator('#f-extra-photo-buttons')).toBeVisible()
    await page.locator('#f-extra-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await expect(page.locator('#f-extra-photos .idf-extra-photo-item')).toHaveCount(1)

    await page.locator('#f-identify-btn').click()
    await expect(page.locator('#f-identify-card')).toBeVisible()
    expect(lastImageCount).toBe(2)
  })

  test('removing the photo hides Identify and the suggestion card', async ({ page }) => {
    await mockCheckDuplicate(page, 0)
    await mockIdentifyCustomResult(page, { productName: 'Test Item', category: 'book' })

    await page.goto('/add-item')
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#f-identify-btn').click()
    await expect(page.locator('#f-identify-card')).toBeVisible()

    await page.locator('#f-photo-remove').click()
    await expect(page.locator('#f-identify-btn')).toBeHidden()
    await expect(page.locator('#f-identify-card')).toBeHidden()
    await expect(page.locator('#f-preview')).toBeHidden()
  })
})
