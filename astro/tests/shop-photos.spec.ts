import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { uniquePng, uniquePngFile } from './helpers/unique-image'

const items = (page: Page) => page.locator('#sp-list .sp-item')
// The captions in order, as the page shows them.
const captions = (page: Page) => items(page).locator('.sp-caption').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))

test.describe('/edit-store: shop photos', () => {
  test('a chosen photo is resized, uploaded into the shop straight away, captioned, and opens in the lightbox', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Photo Shop ${Date.now()}`), area: 'Akihabara' })
    trackDoc(shop._id)
    const uploads: { docId: string; field: string; type: string }[] = []
    page.on('request', (req) => {
      if (!req.url().includes('/api/upload-image') || req.method() !== 'POST') return
      const body = req.postDataBuffer()?.toString('latin1') || ''
      const part = (name: string) => (new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body) || [])[1] || ''
      uploads.push({ docId: part('docId'), field: part('field'), type: (/Content-Type: (image\/\w+)/.exec(body) || [])[1] || '' })
    })

    await page.goto(`/edit-store?id=${shop._id}`)
    await expect(page.locator('#sp-empty')).toBeVisible()
    await page.locator('#sp-gallery').setInputFiles(uniquePngFile())
    const item = items(page).first()
    await expect(item.locator('.sp-status')).toHaveText('Added ✓', { timeout: 20000 })
    await expect(page.locator('#sp-empty')).toBeHidden()
    expect(uploads).toEqual([{ docId: shop._id, field: 'photos', type: 'image/jpeg' }]) // resized to JPEG first
    await expect(item.locator('.sp-img')).toHaveAttribute('src', /^https:\/\/cdn\.sanity\.io\/images\/.+w=240/)
    const key = await item.getAttribute('data-key')

    await item.locator('.sp-caption').fill('Floor guide')
    await item.locator('.sp-caption').dispatchEvent('change')
    await expect(item.locator('.sp-status')).toHaveText('Saved ✓')
    const saved = await sanity.fetch(`*[_id == $id][0]{ photos[]{ _key, caption, "ref": asset._ref } }`, { id: shop._id })
    expect(saved.photos).toEqual([{ _key: key, caption: 'Floor guide', ref: expect.stringMatching(/^image-/) }])

    // After a reload: rendered by the server, caption kept; a tap opens the large photo.
    await page.reload()
    await expect.poll(() => captions(page)).toEqual(['Floor guide'])
    await items(page).first().locator('.sp-img').click()
    await expect(page.locator('dialog.lb-dialog')).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /w=2000/)
  })

  test('▲▼ reorder and Remove (after a confirmation) are saved in the shop', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const asset = await sanity.assets.upload('image', uniquePng(), { filename: 'shop-photo-test.png' })
    uploadedAssets.push(asset._id) // deleted after the shop
    const photo = (key: string, caption: string) => ({ _key: key, _type: 'image', asset: { _type: 'reference', _ref: asset._id }, caption })
    const shop = await sanity.create({
      _type: 'shopNote', shopName: testName(`Photo Order Shop ${Date.now()}`),
      photos: [photo('k1', 'One'), photo('k2', 'Two'), photo('k3', 'Three')],
    })
    trackDoc(shop._id)
    const savedKeys = async () => ((await sanity.fetch(`*[_id == $id][0].photos[]._key`, { id: shop._id })) || []) as string[]

    await page.goto(`/edit-store?id=${shop._id}`)
    await expect.poll(() => captions(page)).toEqual(['One', 'Two', 'Three'])
    await expect(items(page).first().locator('.sp-up')).toBeDisabled()
    await expect(items(page).last().locator('.sp-down')).toBeDisabled()

    await items(page).nth(0).locator('.sp-down').click()
    await expect.poll(() => captions(page)).toEqual(['Two', 'One', 'Three'])
    await expect.poll(savedKeys).toEqual(['k2', 'k1', 'k3'])
    await items(page).nth(2).locator('.sp-up').click()
    await expect.poll(() => captions(page)).toEqual(['Two', 'Three', 'One'])
    await expect.poll(savedKeys).toEqual(['k2', 'k3', 'k1'])

    // Cancel keeps it; OK removes it.
    const messages: string[] = []
    page.once('dialog', (d) => { messages.push(d.message()); d.dismiss() })
    await items(page).nth(1).locator('.sp-remove').click()
    await expect.poll(() => messages).toEqual(['Remove this photo from the shop?'])
    await expect(items(page)).toHaveCount(3)
    page.once('dialog', (d) => d.accept())
    await items(page).nth(1).locator('.sp-remove').click()
    await expect.poll(() => captions(page)).toEqual(['Two', 'One'])
    await expect.poll(savedKeys).toEqual(['k2', 'k1'])

    await page.reload()
    await expect.poll(() => captions(page)).toEqual(['Two', 'One'])
  })

  test('the APIs refuse what isn\'t a shop photo', async ({ request, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Photo API Shop ${Date.now()}`) })
    trackDoc(shop._id)
    const bad = await request.post('/api/shop-photos', { data: { id: shop._id, key: 'nope', action: 'remove' } })
    expect(bad.status()).toBe(404)
    const action = await request.post('/api/shop-photos', { data: { id: shop._id, key: 'nope', action: 'delete-shop' } })
    expect(action.status()).toBe(400)
    // A shop has photos only — no main image.
    const image = await request.post('/api/upload-image', {
      multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: uniquePng() }, docId: shop._id, field: 'image' },
      headers: { Origin: 'http://localhost:4321' }, // a form post from the site itself
    })
    expect(image.status()).toBe(400)
  })
})
