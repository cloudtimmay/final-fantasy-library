import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'

const PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')
const FAKE_ASSET = (n: number) => `image-0000000000000000000000000000000000000${n}-100x100-png`

// Mocks /api/upload-image. Records each call (and whether it carried a docId — a background
// upload never does). `failFirst`: the first call answers 500; `hold`: no answer until the
// test calls release() — deterministic "still uploading", unlike a fixed delay, which a busy
// machine can outlast before the test even taps Save.
async function mockUpload(page: Page, opts: { failFirst?: boolean; hold?: boolean } = {}) {
  const calls: { hasDocId: boolean; at: number }[] = []
  let release = () => {}
  const released = new Promise<void>((r) => { release = r })
  await page.route('**/api/upload-image', async (route) => {
    const body = route.request().postData() || ''
    calls.push({ hasDocId: /name="docId"/.test(body), at: Date.now() })
    if (opts.hold) await released
    if (opts.failFirst && calls.length === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Upload failed' }) })
      return
    }
    const n = calls.length
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, assetId: FAKE_ASSET(n), url: `https://cdn.sanity.io/images/test/development/${n}-100x100.png` }),
    })
  })
  return Object.assign(calls, { release })
}

// Mocks a JSON create/save endpoint and records each request body.
async function mockSave(page: Page, pattern: string, response: Record<string, unknown> = { ok: true, id: 'test-not-created' }) {
  const bodies: any[] = []
  await page.route(pattern, async (route) => {
    bodies.push({ body: route.request().postDataJSON(), at: Date.now() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })
  return bodies
}

async function fillAddPrice(page: Page) {
  await page.locator('#p-name').fill(testName(`Background upload ${Date.now()}`))
  await page.locator('#p-category').selectOption('figure')
  await page.locator('#p-price').fill('1000')
}

test.describe('background photo upload: /add-price', () => {
  test('the photo uploads as soon as it is chosen; Save only references it (no second upload)', async ({ page }) => {
    const uploads = await mockUpload(page)
    const saves = await mockSave(page, '**/api/price-entry')
    await page.goto('/add-price')
    await fillAddPrice(page)

    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)
    expect(uploads[0].hasDocId).toBe(false) // a standalone asset, before any document exists

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')
    expect(saves).toHaveLength(1)
    expect(saves[0].body.imageAssetId).toBe(FAKE_ASSET(1))
    expect(uploads).toHaveLength(1)
  })

  test('removing the photo before saving discards the upload', async ({ page }) => {
    const uploads = await mockUpload(page)
    const saves = await mockSave(page, '**/api/price-entry')
    await page.goto('/add-price')
    await fillAddPrice(page)

    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)
    await page.locator('#p-photo-remove').click()

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')
    expect(saves[0].body.imageAssetId).toBeUndefined()
    expect(uploads).toHaveLength(1)
  })

  test('replacing the photo references the new upload, not the old one', async ({ page }) => {
    const uploads = await mockUpload(page)
    const saves = await mockSave(page, '**/api/price-entry')
    await page.goto('/add-price')
    await fillAddPrice(page)

    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)
    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(2)

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')
    expect(saves[0].body.imageAssetId).toBe(FAKE_ASSET(2))
  })

  test('Save waits for an upload that is still running', async ({ page }) => {
    const uploads = await mockUpload(page, { hold: true })
    const saves = await mockSave(page, '**/api/price-entry')
    await page.goto('/add-price')
    await fillAddPrice(page)

    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)
    await page.locator('#p-save').click() // the upload is held, so it's still in flight
    await expect(page.locator('#p-save')).toHaveText('Uploading photo…')
    expect(saves).toHaveLength(0) // Save is waiting, not saving without the photo

    const releasedAt = Date.now()
    uploads.release()
    await expect(page.locator('#p-msg')).toContainText('Saved')
    expect(saves[0].body.imageAssetId).toBe(FAKE_ASSET(1))
    expect(saves[0].at).toBeGreaterThanOrEqual(releasedAt)
    expect(uploads).toHaveLength(1)
  })

  test('a failed background upload is retried once on Save', async ({ page }) => {
    const uploads = await mockUpload(page, { failFirst: true })
    const saves = await mockSave(page, '**/api/price-entry')
    await page.goto('/add-price')
    await fillAddPrice(page)

    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)

    await page.locator('#p-save').click()
    await expect(page.locator('#p-msg')).toContainText('Saved')
    expect(uploads).toHaveLength(2)
    expect(saves[0].body.imageAssetId).toBe(FAKE_ASSET(2))
  })
})

test.describe('background photo upload: /add-item and /edit-product', () => {
  test('/add-item: the create call carries the background-uploaded asset id', async ({ page }) => {
    await page.route('**/api/check-duplicate*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, matches: [] }) })
    )
    const uploads = await mockUpload(page)
    const saves = await mockSave(page, '**/api/album-create')
    await page.goto('/add-item')
    await page.locator('#f-title').fill(testName(`Background upload album ${Date.now()}`))

    await page.locator('#f-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)
    await page.locator('#f-save').click()
    await expect(page.locator('#f-msg')).toContainText('Saved')
    expect(saves[0].body.imageAssetId).toBe(FAKE_ASSET(1))
    expect(uploads).toHaveLength(1)
  })

  test('/edit-product: a new photo uploads in the background; Save sends its asset id', async ({ page, sanity, trackDoc }) => {
    const entry = await sanity.create({
      _type: 'priceEntry',
      productName: testName(`Background upload product ${Date.now()}`),
      category: 'figure',
      sourceType: 'japanStore',
      price: 1000,
      currency: 'JPY',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(entry._id)
    const uploads = await mockUpload(page)
    const saves = await mockSave(page, '**/api/price-product-update', { ok: true })

    await page.goto(`/edit-product?product=${encodeURIComponent(entry.productName.trim().toLowerCase())}`)
    await page.locator('#p-photo-gallery').setInputFiles(PHOTO)
    await expect.poll(() => uploads.length).toBe(1)
    expect(uploads[0].hasDocId).toBe(false)

    await page.locator('#p-save').click()
    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0].body.imageAssetId).toBe(FAKE_ASSET(1))
    expect(uploads).toHaveLength(1)
  })
})
