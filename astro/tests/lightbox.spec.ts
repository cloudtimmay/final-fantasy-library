import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'

const PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')
const dialog = (page: Page) => page.locator('dialog.lb-dialog')

// A chosen photo on /add-price is uploaded in the background — answer that without Sanity.
async function mockUpload(page: Page) {
  await page.route('**/api/upload-image', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, assetId: 'image-test-100x100-png', url: 'https://cdn.sanity.io/images/test/development/x-100x100.png' }) })
  )
}

test.describe('lightbox: tap a photo to enlarge', () => {
  test('/add-price preview: opens full screen; closes with the button, Escape, a tap outside and back', async ({ page }) => {
    await mockUpload(page)
    await page.goto('/add-price')
    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    const preview = page.locator('#p-preview')
    await expect(preview).toBeVisible()

    // Open, close with the ✕ button.
    await preview.click()
    await expect(dialog(page)).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /^blob:/) // the chosen photo itself
    await page.locator('.lb-close').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page).toHaveURL(/\/add-price$/)

    // Escape.
    await preview.click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()

    // A tap outside the photo (the dimmed area above it — the photo is centred and fills the width).
    await preview.click()
    await expect(dialog(page)).toBeVisible()
    const box = (await page.locator('.lb-img').boundingBox())!
    expect(box.y).toBeGreaterThan(20)
    await page.mouse.click(box.x + box.width / 2, box.y / 2)
    await expect(dialog(page)).toBeHidden()

    // Back closes it instead of leaving the page.
    await preview.click()
    await expect(dialog(page)).toBeVisible()
    await page.goBack()
    await expect(dialog(page)).toBeHidden()
    await expect(page).toHaveURL(/\/add-price$/)
    await expect(preview).toBeVisible() // still on the same page, form intact
  })

  test('closing with the button takes back its history entry (back then leaves the page as usual)', async ({ page }) => {
    await mockUpload(page)
    await page.goto('/scan')
    await page.goto('/add-price')
    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await page.locator('#p-preview').click()
    await expect(dialog(page)).toBeVisible()
    await page.locator('.lb-close').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page).toHaveURL(/\/add-price$/)

    await page.goBack()
    await expect(page).toHaveURL(/\/scan$/)
  })

  test('collection detail page: the photo opens at its large URL', async ({ page, sanity, trackDoc, baseURL }) => {
    const cover = `${baseURL}/icons/album.png`
    const album = await sanity.create({ _type: 'album', title: testName(`Lightbox album ${Date.now()}`), status: 'owned', externalImageUrl: cover })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    const photo = page.locator('img.detail-photo')
    await expect(photo).toHaveAttribute('data-lightbox', cover)
    await photo.click()
    await expect(dialog(page)).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', cover)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })

  test('/scan: a photo inside a result link opens the lightbox instead of following the link', async ({ page, sanity, trackDoc, baseURL }) => {
    const title = testName(`Lightbox scan ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, status: 'owned', externalImageUrl: `${baseURL}/icons/album.png` })
    trackDoc(album._id)

    await page.goto(`/scan?q=${encodeURIComponent(title)}`)
    const thumb = page.locator('a.result-row', { hasText: title }).locator('img.result-thumb')
    await thumb.click()
    await expect(dialog(page)).toBeVisible()
    await expect(page).toHaveURL(/\/scan\?q=/) // didn't navigate to the album
    await page.locator('.lb-close').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page).toHaveURL(/\/scan\?q=/)
  })
})
