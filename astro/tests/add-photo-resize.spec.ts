import { test, expect, testName } from './fixtures'
import { findIdByField } from './helpers/sanity-test-client'

test.describe('add family purchase: photo', () => {
  test('resizes the photo to at most 1600px JPEG before uploading', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: testName(`Add Photo Trip ${Date.now()}`),
      childBudgets: [{ _key: 'k1', person: 'Tone', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    // WebKit leaves file bytes out of an intercepted multipart body, so the uploaded
    // file's size is read in the page, from the FormData actually handed to fetch().
    await page.addInitScript(() => {
      const origFetch = window.fetch
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/api/upload-image') && init?.body instanceof FormData) {
          const file = init.body.get('file') as File
          const bmp = await createImageBitmap(file)
          ;(window as any).__uploadedPhoto = { name: file.name, type: file.type, width: bmp.width, height: bmp.height }
        }
        return origFetch(input, init)
      }
    })
    let uploads = 0
    await page.route('**/api/upload-image', async (route) => {
      uploads++
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/add')

    // A 3000x2000 PNG, well over the 1600px limit.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 3000
      c.height = 2000
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#c33'
      ctx.fillRect(0, 0, c.width, c.height)
      return c.toDataURL('image/png')
    })

    await page.locator('#f-trip').selectOption(trip._id)
    await page.locator('#f-person').selectOption('Tone')
    const name = testName(`Photo Item ${Date.now()}`)
    await page.locator('#f-name').fill(name)
    await page.locator('#f-yen').fill('1000')

    await page.locator('#f-photo-gallery').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
    })
    await expect(page.locator('#f-photo-name')).toHaveText('big.png')

    await page.locator('#f-save').click()
    await expect(page.locator('#f-msg')).toContainText('Saved')
    trackDoc(await findIdByField('familyPurchase', 'name', name))

    expect(uploads).toBe(1)
    const uploaded = await page.evaluate(() => (window as any).__uploadedPhoto)
    expect(uploaded).toEqual({ name: 'big.jpg', type: 'image/jpeg', width: 1600, height: 1067 })
  })
})
