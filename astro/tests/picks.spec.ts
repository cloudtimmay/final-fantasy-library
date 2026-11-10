import { test, expect, testName, uniqueJan } from './fixtures'
import { uniquePng } from './helpers/unique-image'
import { accessUserFrom, accessUserName, ACCESS_EMAIL_HEADER } from '../src/lib/access-users'
import { groupPicksByShop, isNewSince, matchesPickFilter, pickedText } from '../src/lib/picks'

// "💚 Picks": choosing at home which of the products photographed in shops to buy.
// The Cloudflare Access login is simulated with its header (Cf-Access-Authenticated-User-Email).
const HOME = 'picks-home-test@example.com'

test.describe('who is logged in (lib/access-users.ts)', () => {
  test('the Access email, shown as a listed name, else as itself; nothing without the header', () => {
    const names = { 'tone@example.com': 'Tone' }
    expect(accessUserName('Tone@Example.com ', names)).toBe('Tone')
    expect(accessUserName('someone@example.com', names)).toBe('someone@example.com')
    const req = (headers: Record<string, string>) => new Request('https://x.test/api/price-pick', { headers })
    expect(accessUserFrom(req({ [ACCESS_EMAIL_HEADER]: 'tone@example.com' }), names)).toEqual({ email: 'tone@example.com', name: 'Tone' })
    expect(accessUserFrom(req({}), names)).toBeNull()
    expect(accessUserFrom(req({ [ACCESS_EMAIL_HEADER]: 'not-an-email' }), names)).toBeNull()
  })
})

test.describe('api/price-pick', () => {
  const entry = async (sanity: any, trackDoc: (id: string) => void, extra: Record<string, unknown> = {}) => {
    const doc = await sanity.create({
      _type: 'priceEntry', productName: testName(`Pick Entry ${Date.now()}`), jan: uniqueJan(), category: 'figure',
      sourceType: 'japanStore', price: 5980, currency: 'JPY', condition: 'new', status: 'considering', seenAt: new Date().toISOString(),
      note: 'Shelf 3', ...extra,
    })
    trackDoc(doc._id)
    return doc
  }
  const post = (request: any, data: unknown, email: string | null = HOME) =>
    request.post('/api/price-pick', { data, headers: email ? { [ACCESS_EMAIL_HEADER]: email } : {} })
  // Everything but the pick fields and Sanity's own bookkeeping.
  const rest = (d: any) => Object.fromEntries(Object.entries(d).filter(([k]) => !['pick', 'pickedBy', 'pickedAt', 'pickNote', '_rev', '_updatedAt'].includes(k)))

  test('buy: only the pick fields change; who picked comes from the Cloudflare header, not the body', async ({ request, sanity, trackDoc }) => {
    const before = await entry(sanity, trackDoc)
    const res = await post(request, { id: before._id, pick: 'buy', pickedBy: 'Someone Else', price: 1, status: 'bought' })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toMatchObject({ ok: true, pick: 'buy', pickedBy: HOME })
    const after = await sanity.getDocument(before._id)
    expect(after).toMatchObject({ pick: 'buy', pickedBy: HOME })
    expect(Date.now() - new Date(after.pickedAt).getTime()).toBeLessThan(5 * 60_000)
    expect(rest(after)).toEqual(rest(before)) // price, status, note … untouched
  })

  test('tapping again takes it off; the comment is saved and cleared on its own', async ({ request, sanity, trackDoc }) => {
    const e = await entry(sanity, trackDoc)
    await post(request, { id: e._id, pick: 'skip' })
    expect((await post(request, { id: e._id, note: '  Too expensive  ' })).status()).toBe(200)
    let doc = await sanity.getDocument(e._id)
    expect(doc).toMatchObject({ pick: 'skip', pickedBy: HOME, pickNote: 'Too expensive' })
    expect((await post(request, { id: e._id, pick: null })).status()).toBe(200)
    doc = await sanity.getDocument(e._id)
    expect(doc.pick).toBeUndefined()
    expect(doc.pickedBy).toBeUndefined()
    expect(doc.pickedAt).toBeUndefined()
    expect(doc.pickNote).toBe('Too expensive')
    await post(request, { id: e._id, note: '' })
    expect((await sanity.getDocument(e._id)).pickNote).toBeUndefined()
  })

  test('only a price entry, only a valid pick; nothing changed otherwise', async ({ request, sanity, trackDoc }) => {
    const e = await entry(sanity, trackDoc)
    expect((await post(request, { id: e._id, pick: 'maybe' })).status()).toBe(400)
    expect((await post(request, { id: e._id })).status()).toBe(400)
    expect((await post(request, { pick: 'buy' })).status()).toBe(400)
    expect((await post(request, { id: `does-not-exist-${Date.now()}`, pick: 'buy' })).status()).toBe(404)
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Not An Entry ${Date.now()}`) })
    trackDoc(shop._id)
    expect((await post(request, { id: shop._id, pick: 'buy' })).status()).toBe(400)
    expect((await sanity.getDocument(shop._id))._rev).toBe(shop._rev)
    expect((await sanity.getDocument(e._id))._rev).toBe(e._rev)
  })
})

test.describe('picks (lib/picks.ts)', () => {
  const doc = (id: string, seenAt: string, extra: Record<string, unknown> = {}) => ({ _id: id, productName: `P ${id}`, imageUrl: 'https://cdn.sanity.io/x.png', price: 1000, currency: 'JPY', seenAt, ...extra })

  test('grouped by shop (with area), newest first; without a shop under its store name; no photo, no card', () => {
    const groups = groupPicksByShop([
      doc('a1', '2026-12-05T10:00:00Z', { shopId: 'A', shopName: 'Super Potato', area: 'Akihabara' }),
      doc('b1', '2026-12-05T12:00:00Z', { shopId: 'B', shopName: 'Mandarake', area: 'Nakano' }),
      doc('a2', '2026-12-05T11:00:00Z', { shopId: 'A', shopName: 'Super Potato', area: 'Akihabara' }),
      doc('o1', '2026-12-04T09:00:00Z', { sourceName: 'Mercari' }),
      doc('x', '2026-12-06T09:00:00Z', { shopId: 'A', imageUrl: null }),
    ])
    expect(groups.map((g) => [g.shopName, g.area, g.items.map((i) => i.id)])).toEqual([
      ['Mandarake', 'Nakano', ['b1']],
      ['Super Potato', 'Akihabara', ['a2', 'a1']],
      ['Mercari', '', ['o1']],
    ])
  })

  test('"picked by", new since the last visit, and the filter', () => {
    expect(pickedText('buy', 'Tone', '2026-12-05T05:32:00Z', 'Europe/Oslo')).toBe('💚 picked by Tone, 5 Dec, 06:32')
    expect(pickedText('skip', 'Tone', '2026-12-05T05:32:00Z', 'Europe/Oslo')).toBe('👎 skipped by Tone, 5 Dec, 06:32')
    expect(pickedText(null, 'Tone', '')).toBe('')
    const last = '2026-12-05T00:00:00Z'
    const item = (seen: string, pick: any = null, pickedAt = '', pickedBy = '') => ({ seen, pick, pickedAt, pickedBy })
    expect(isNewSince(item('2026-12-05T10:00:00Z'), last, 'Tone')).toBe(true) // seen since
    expect(isNewSince(item('2026-12-04T10:00:00Z'), last, 'Tone')).toBe(false)
    expect(isNewSince(item('2026-12-04T10:00:00Z', 'buy', '2026-12-05T08:00:00Z', 'Kim'), last, 'Tone')).toBe(true) // picked since, by someone else
    expect(isNewSince(item('2026-12-04T10:00:00Z', 'buy', '2026-12-05T08:00:00Z', 'Tone'), last, 'Tone')).toBe(false) // my own pick
    expect(isNewSince(item('2026-12-05T10:00:00Z'), null, 'Tone')).toBe(false) // a first visit
    expect([null, 'buy', 'skip'].map((p: any) => matchesPickFilter(p, 'none'))).toEqual([true, false, false])
    expect([null, 'buy', 'skip'].map((p: any) => matchesPickFilter(p, 'buy'))).toEqual([false, true, false])
    expect([null, 'buy', 'skip'].map((p: any) => matchesPickFilter(p, 'all'))).toEqual([true, true, true])
  })
})

test.describe('/picks', () => {
  // A shop with three photographed products still Considering (one seen two days ago), one
  // without a photo and one bought (neither shown).
  async function setup(sanity: any, trackDoc: (id: string) => void, uploadedAssets: string[]) {
    const asset = await sanity.assets.upload('image', uniquePng(), { filename: 'picks-test.png' })
    uploadedAssets.push(asset._id)
    const tag = Date.now()
    const shop = await sanity.create({ _type: 'shopNote', shopName: testName(`Picks Shop ${tag}`), area: `Picks Area ${tag}` })
    trackDoc(shop._id)
    const image = { _type: 'image', asset: { _type: 'reference', _ref: asset._id } }
    const mk = async (name: string, minutesAgo: number, extra: Record<string, unknown> = {}) => {
      const d = await sanity.create({
        _type: 'priceEntry', productName: testName(`${name} ${tag}`), jan: uniqueJan(), category: 'figure', sourceType: 'japanStore',
        shop: { _type: 'reference', _ref: shop._id, _weak: true }, price: 5980, currency: 'JPY', condition: 'new', status: 'considering',
        seenAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), image, ...extra,
      })
      trackDoc(d._id)
      return d
    }
    const newest = await mk('Cloud Figure', 5, { note: 'Last one on the shelf' })
    const middle = await mk('Tifa Figure', 60)
    const old = await mk('Moogle Plush', 2 * 24 * 60)
    await mk('No Photo Item', 10, { image: undefined })
    await mk('Bought Item', 10, { status: 'bought' })
    return { shop, tag, newest, middle, old }
  }
  const group = (page: any, shopName: string) => page.locator('.pk-group').filter({ has: page.locator('.pk-shop', { hasText: shopName }) })
  const card = (page: any, name: string) => page.locator('.pk-card').filter({ has: page.locator('.pk-name', { hasText: name }) })

  test('by shop with its area, newest first; buy, tap again to take it off, skip (dimmed); the comment; who picked', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    test.setTimeout(60_000)
    const { shop, tag, newest, middle, old } = await setup(sanity, trackDoc, uploadedAssets)
    await page.setExtraHTTPHeaders({ [ACCESS_EMAIL_HEADER]: HOME }) // the Cloudflare Access login
    await page.goto('/picks')
    await expect(page.getByRole('heading', { name: '💚 Picks' })).toBeVisible()
    const g = group(page, shop.shopName)
    await expect(g.locator('.pk-area')).toHaveText(`📍 Picks Area ${tag}`)
    await expect(g.locator('.pk-name')).toHaveText([newest.productName, middle.productName, old.productName])
    const c = card(page, newest.productName)
    await expect(c.locator('.pk-price')).toHaveText(/¥5\s980/)
    await expect(c.locator('.pk-seen')).toHaveText(/^Seen /)
    await expect(c.locator('.pk-note')).toHaveText('Last one on the shelf')
    await expect(c.locator('.pk-img')).toHaveAttribute('data-lightbox', /cdn\.sanity\.io/)

    // 💚 Buy this: green, saved, "picked by" the login.
    await c.locator('.pk-btn-buy').click()
    await expect(c).toHaveClass(/pk-buy/)
    await expect(c.locator('.pk-picked')).toHaveText(new RegExp(`^💚 picked by ${HOME.replace(/[.]/g, '\\.')}, `))
    await expect.poll(async () => (await sanity.getDocument(newest._id)).pick).toBe('buy')
    expect((await sanity.getDocument(newest._id)).pickedBy).toBe(HOME)
    // Tapping it again takes it off.
    await c.locator('.pk-btn-buy').click()
    await expect(c).not.toHaveClass(/pk-buy/)
    await expect(c.locator('.pk-picked')).toBeHidden()
    await expect.poll(async () => (await sanity.getDocument(newest._id)).pick ?? null).toBeNull()

    // 👎 Skip: dimmed; the comment saved on its own.
    const m = card(page, middle.productName)
    await m.locator('.pk-btn-skip').click()
    await expect(m).toHaveClass(/pk-skip/)
    expect(Number(await m.evaluate((el: HTMLElement) => getComputedStyle(el).opacity))).toBeLessThan(1)
    await m.locator('.pk-comment').fill('We have this one')
    await m.locator('.pk-comment').blur()
    await expect(m.locator('.pk-msg')).toHaveText('Comment saved ✓')
    expect(await sanity.getDocument(middle._id)).toMatchObject({ pick: 'skip', pickNote: 'We have this one', pickedBy: HOME })
  })

  test('the filter: All / Buy / Skip / Not decided', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    test.setTimeout(60_000)
    const { shop, newest, middle, old } = await setup(sanity, trackDoc, uploadedAssets)
    await sanity.patch(newest._id).set({ pick: 'buy', pickedBy: 'Tone', pickedAt: new Date().toISOString() }).commit()
    await sanity.patch(middle._id).set({ pick: 'skip', pickedBy: 'Tone', pickedAt: new Date().toISOString() }).commit()
    await page.goto('/picks')
    const g = group(page, shop.shopName)
    const shown = () => g.locator('.pk-card:visible .pk-name')
    await expect(card(page, newest.productName)).toHaveClass(/pk-buy/)
    await expect(card(page, newest.productName).locator('.pk-picked')).toHaveText(/^💚 picked by Tone, /)
    await page.locator('.pk-filter[data-filter="buy"]').click()
    await expect(shown()).toHaveText([newest.productName])
    await page.locator('.pk-filter[data-filter="skip"]').click()
    await expect(shown()).toHaveText([middle.productName])
    await page.locator('.pk-filter[data-filter="none"]').click()
    await expect(shown()).toHaveText([old.productName])
    await page.locator('.pk-filter[data-filter="all"]').click()
    await expect(shown()).toHaveCount(3)
  })

  test('new since the last visit: a count at the top and a mark on each, per browser', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    test.setTimeout(60_000)
    const { shop, newest, middle, old } = await setup(sanity, trackDoc, uploadedAssets)
    // Picked by someone else since the last visit (a day ago); the old one was seen before it.
    await sanity.patch(old._id).set({ pick: 'buy', pickedBy: 'Kim', pickedAt: new Date().toISOString() }).commit()
    const lastVisit = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
    await page.goto('/add-menu')
    await page.evaluate((v: string) => localStorage.setItem('ff-picks-last-visit', v), lastVisit)
    await page.goto('/picks')
    await expect(page.locator('#pk-new-count')).toHaveText(/^🆕 \d+ new since your last visit$/)
    const g = group(page, shop.shopName)
    for (const d of [newest, middle, old]) await expect(card(page, d.productName).locator('.pk-new')).toBeVisible()
    // The visit is remembered: on the next one, none of these is new any more.
    const stored = await page.evaluate(() => localStorage.getItem('ff-picks-last-visit'))
    expect(stored! > lastVisit).toBe(true)
    await page.reload()
    await expect(g.locator('.pk-new:visible')).toHaveCount(0)
    await expect(page.locator('#pk-new-count')).toBeVisible()
  })

  test('a first visit marks nothing new', async ({ page, sanity, trackDoc, uploadedAssets }) => {
    const { shop } = await setup(sanity, trackDoc, uploadedAssets)
    await page.goto('/picks')
    await expect(page.locator('#pk-new-count')).toBeHidden()
    await expect(group(page, shop.shopName).locator('.pk-new:visible')).toHaveCount(0)
  })
})
