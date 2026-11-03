import fs from 'node:fs'
import path from 'node:path'
import { test, expect, testName, uniqueJan } from './fixtures'
import { foundItems, foundThumbs, formatFoundDate } from '../src/lib/shop-found'

const PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')
const ref = (id: string, weak = false) => ({ _type: 'reference', _ref: id, ...(weak ? { _weak: true } : {}) })

test.describe('shop-found (lib/shop-found.ts)', () => {
  test('prices and purchases newest first; one thumbnail per product, "+N" for the rest', () => {
    const items = foundItems(
      [
        { _id: 'p1', productName: 'FF7 OST', jan: '111', price: 5980, currency: 'JPY', status: 'considering', seenAt: '2026-11-01T10:00:00Z' },
        { _id: 'p2', productName: 'FF7 OST', jan: '111', price: 5500, currency: 'JPY', status: 'bought', seenAt: '2026-11-03T09:00:00Z' },
        { _id: 'p3', productName: 'Moogle plush', price: 2000, currency: 'JPY', seenAt: '2026-10-30T09:00:00Z' },
        { _id: 'p4', productName: '', price: 1 }, // no name: skipped
      ],
      [{ _id: 'f1', name: 'Chocobo keyring', priceYen: 800, purchaseDate: '2026-11-02' }],
    )
    expect(items.map((i) => i.id)).toEqual(['p2', 'f1', 'p1', 'p3'])
    expect(items[0]).toMatchObject({ kind: 'price', status: 'bought', href: '/edit-price?id=p2' })
    expect(items[1]).toMatchObject({ kind: 'purchase', status: 'bought', href: null, price: 800, currency: 'JPY' })
    expect(items[2]).toMatchObject({ status: 'considering' })
    // p1 and p2 are the same product (JAN 111): one thumbnail, its newest price.
    expect(foundThumbs(items, 2)).toEqual({ thumbs: [items[0], items[1]], more: 1 })
    expect(foundThumbs([], 4)).toEqual({ thumbs: [], more: 0 })
    expect(formatFoundDate('2026-11-02')).toBe('Nov 2, 2026')
  })
})

test.describe('/edit-store: "Found here"', () => {
  test('the shop\'s prices and its purchases that didn\'t come from a price, newest first, with status and links', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Found Shop ${Date.now()}`) })
    trackDoc(shop._id)
    const other = await sanity.create({ _type: 'shopNote', shopName: testName(`Other Shop ${Date.now()}`) })
    trackDoc(other._id)
    const asset = await sanity.assets.upload('image', fs.readFileSync(PHOTO), { filename: 'found-here-test.png' })
    uploadedAssets.push(asset._id)

    const fromPrice = await sanity.create({ _type: 'familyPurchase', person: 'Kim', name: testName('Bought From Price'), store: ref(shop._id), status: 'bought', purchaseDate: '2026-11-03', priceYen: 5500 })
    trackDoc(fromPrice._id)
    const price = (name: string, extra: Record<string, unknown>) => sanity.create({
      _type: 'priceEntry', productName: testName(name), jan: uniqueJan(), price: 5980, currency: 'JPY',
      sourceType: 'japanStore', shop: ref(shop._id, true), ...extra,
    })
    const considering = await price('Found Considering', { status: 'considering', seenAt: '2026-11-01T10:00:00Z' })
    const bought = await price('Found Bought', {
      status: 'bought', seenAt: '2026-11-03T09:00:00Z', price: 5500,
      image: { _type: 'image', asset: ref(asset._id) }, createdFamilyPurchase: ref(fromPrice._id, true),
    })
    const elsewhere = await price('Found Elsewhere', { status: 'considering', seenAt: '2026-11-04T09:00:00Z', shop: ref(other._id, true) })
    const purchase = await sanity.create({ _type: 'familyPurchase', person: 'Kim', name: testName('Found Keyring'), store: ref(shop._id), status: 'bought', purchaseDate: '2026-11-02', priceYen: 800 })
    for (const d of [considering, bought, elsewhere, purchase]) trackDoc(d._id)

    await page.goto(`/edit-store?id=${shop._id}`)
    const rows = page.locator('#found-here .fh-item')
    await expect(rows.locator('.fh-name')).toHaveText([bought.productName, purchase.name, considering.productName])
    await expect(rows.nth(0).locator('.fh-status')).toHaveText('✅ Bought')
    await expect(rows.nth(1).locator('.fh-status')).toHaveText('✅ Bought')
    await expect(rows.nth(1).locator('.fh-kind')).toHaveText('Family purchase')
    await expect(rows.nth(2).locator('.fh-status')).toHaveText('🤔 Considering')
    await expect(rows.nth(2).locator('.fh-price')).toHaveText(/¥5\s980/)
    await expect(rows.nth(1).locator('.fh-date')).toHaveText('Nov 2, 2026')
    // Prices open /edit-price; a family purchase has no page.
    await expect(rows.nth(0).locator('a.fh-link')).toHaveAttribute('href', `/edit-price?id=${bought._id}`)
    await expect(rows.nth(1).locator('a')).toHaveCount(0)

    // The photo opens the lightbox instead of the link.
    await rows.nth(0).locator('.fh-img').click()
    await expect(page.locator('dialog.lb-dialog')).toBeVisible()
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /w=2000/)
    await page.locator('.lb-close').click()
    await expect(page).toHaveURL(new RegExp(`/edit-store\\?id=${shop._id}$`))

    await rows.nth(2).locator('.fh-name').click()
    await expect(page).toHaveURL(new RegExp(`/edit-price\\?id=${considering._id}$`))
  })

  test('a shop with nothing found says so', async ({ page, sanity, trackDoc }) => {
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Empty Found Shop ${Date.now()}`) })
    trackDoc(shop._id)
    await page.goto(`/edit-store?id=${shop._id}`)
    await expect(page.locator('#found-here .fh-empty')).toBeVisible()
    await expect(page.locator('#found-here .fh-item')).toHaveCount(0)
  })
})
