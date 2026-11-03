import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, testName, uniqueJan } from './fixtures'

const PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')
const ref = (id: string, weak = false) => ({ _type: 'reference', _ref: id, ...(weak ? { _weak: true } : {}) })
const card = (page: Page, name: string) => page.locator('.note-card').filter({ has: page.locator('.note-name', { hasText: name }) })

test.describe('/notes: what was found at each shop', () => {
  test('up to 4 thumbnails, one per product and newest first, "+N" for the rest, linking to "Found here"; none without finds', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Thumbs Shop ${Date.now()}`), placeType: 'shop' })
    trackDoc(shop._id)
    const bare = await sanity.create({ _type: 'shopNote', shopName: testName(`Bare Shop ${Date.now()}`), placeType: 'shop' })
    trackDoc(bare._id)
    const asset = await sanity.assets.upload('image', fs.readFileSync(PHOTO), { filename: 'notes-found-test.png' })
    uploadedAssets.push(asset._id)

    // Five products seen on 1–5 November (the newest with a photo), one of them twice, plus a
    // family purchase on the 6th: six items, so 4 thumbnails and "+2".
    const jans = [uniqueJan(), uniqueJan(), uniqueJan(), uniqueJan(), uniqueJan()]
    const names = ['Thumb A', 'Thumb B', 'Thumb C', 'Thumb D', 'Thumb E'].map((n) => testName(n))
    const docs = await Promise.all([
      ...names.map((name, i) => sanity.create({
        _type: 'priceEntry', productName: name, jan: jans[i], price: 1000 + i, currency: 'JPY', sourceType: 'japanStore',
        shop: ref(shop._id, true), status: 'considering', seenAt: `2026-11-0${i + 1}T10:00:00Z`,
        ...(i === 4 ? { image: { _type: 'image', asset: ref(asset._id) } } : {}),
      })),
      sanity.create({
        _type: 'priceEntry', productName: names[0], jan: jans[0], price: 900, currency: 'JPY', sourceType: 'japanStore',
        shop: ref(shop._id, true), status: 'considering', seenAt: '2026-10-20T10:00:00Z',
      }),
      sanity.create({ _type: 'familyPurchase', person: 'Kim', name: testName('Thumb Keyring'), store: ref(shop._id), status: 'bought', purchaseDate: '2026-11-06', priceYen: 800 }),
    ])
    docs.forEach((d) => trackDoc(d._id))

    await page.goto('/notes')
    const row = card(page, shop.shopName).locator('.note-found')
    await expect(row).toHaveAttribute('href', `/edit-store?id=${shop._id}#found-here`)
    const thumbs = row.locator('.note-found-img')
    await expect(thumbs).toHaveCount(4)
    // Newest first: the keyring (6 Nov, no photo), then E (5 Nov, with its photo), D, C.
    await expect(thumbs.nth(0)).toHaveAttribute('title', docs[6].name)
    await expect(thumbs.nth(1)).toHaveAttribute('src', /^https:\/\/cdn\.sanity\.io\/images\/.+w=96&fit=max&auto=format$/)
    await expect(thumbs.nth(1)).toHaveAttribute('alt', names[4])
    await expect(thumbs.nth(2)).toHaveAttribute('title', names[3])
    await expect(thumbs.nth(3)).toHaveAttribute('title', names[2])
    await expect(row.locator('.note-found-more')).toHaveText('+2') // B and A (A counted once)

    await expect(card(page, bare.shopName).locator('.note-found')).toHaveCount(0)

    await row.click()
    await expect(page).toHaveURL(new RegExp(`/edit-store\\?id=${shop._id}#found-here$`))
    await expect(page.locator('#found-here .fh-item')).toHaveCount(7) // every price and the purchase
  })
})
