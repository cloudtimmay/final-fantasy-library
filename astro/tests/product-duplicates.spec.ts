import { test, expect, testName, uniqueJan } from './fixtures'
import { normalizeJpName, jpNamesMatch, findPossibleDuplicates, pickKeptProduct, MIN_JP_MATCH_LENGTH } from '../src/lib/product-duplicates'
import { IDENTIFY_SYSTEM_PROMPT } from '../src/lib/identify-result'

// A Japanese name unique to this test run, so a fixture never pairs with real products (or
// another test's) that share a character name.
// The row of the product with this name — matched on the name itself, not the whole row's text
// (another row's "Possible duplicate of <name>" note would match too).
const productRow = (page: import('@playwright/test').Page, name: string) =>
  page.locator('#product-group-view li.price-row').filter({ has: page.locator('.summary-name', { hasText: name }) })
const uniqueJp = () => `アルフォンス・エルリック${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 1000)}`

test.describe('possible duplicates: matching rules', () => {
  test('Japanese names normalize full/half-width and punctuation like ・', () => {
    expect(normalizeJpName('アルフォンス・エルリック')).toBe('アルフォンスエルリック')
    expect(jpNamesMatch('アルフォンス・エルリック', 'ｱﾙﾌｫﾝｽ･ｴﾙﾘｯｸ')).toBe(true)
    expect(jpNamesMatch(' アルフォンス エルリック ', 'アルフォンス・エルリック')).toBe(true)
    expect(jpNamesMatch('ＦＦⅦリバース', 'ffⅶリバース')).toBe(true)
    expect(jpNamesMatch('アルフォンス・エルリック', 'エドワード・エルリック')).toBe(false)
  })

  test(`names shorter than ${MIN_JP_MATCH_LENGTH} characters never match`, () => {
    expect(jpNamesMatch('アル', 'アル')).toBe(false)
    expect(jpNamesMatch('', '')).toBe(false)
  })

  test('pairs need the same category, and the same Japanese name or the same photo; each pair once', () => {
    const p = (key: string, extra: Record<string, unknown>) => ({ key, productName: key, prices: [1], ...extra })
    const pairs = findPossibleDuplicates([
      p('a', { category: 'figure', productNameJp: 'アルフォンス・エルリック' }),
      p('b', { category: 'figure', productNameJp: 'ｱﾙﾌｫﾝｽ･ｴﾙﾘｯｸ' }),
      p('c', { category: 'game', productNameJp: 'アルフォンス・エルリック' }), // other category
      p('d', { category: 'book', image: { assetId: 'image-x' } }),
      p('e', { category: 'book', image: { assetId: 'image-x' } }),
    ])
    expect(pairs.map((x) => [x.kept.key, x.merged.key, x.reason])).toEqual([
      ['a', 'b', 'jp-name'],
      ['d', 'e', 'image'],
    ])
  })

  test('the kept product: the one with a JAN, otherwise the one with more prices', () => {
    const a = { key: 'a', productName: 'A', prices: [1, 2, 3] }
    const b = { key: 'b', productName: 'B', jan: '2012345678901', prices: [1] }
    expect(pickKeptProduct(a, b).kept.key).toBe('b')
    expect(pickKeptProduct(a, { ...b, jan: undefined }).kept.key).toBe('a')
  })

  test('the identify prompt asks for the full product name, not only the character', () => {
    expect(IDENTIFY_SYSTEM_PROMPT).toContain("productNameJp: string, the product's full name in Japanese exactly as printed on the packaging")
    expect(IDENTIFY_SYSTEM_PROMPT).toContain("never only the character's name")
    expect(IDENTIFY_SYSTEM_PROMPT).toContain("productName: string, the product's full name in English")
    expect(IDENTIFY_SYSTEM_PROMPT).toContain('product line or type, character, and edition/variant')
  })
})

const entry = (productName: string, extra: Record<string, unknown>) => ({
  _type: 'priceEntry', productName, category: 'figure', sourceType: 'japanStore', price: 5000, currency: 'JPY',
  condition: 'new', status: 'considering', seenAt: new Date().toISOString(), ...extra,
})

test.describe('/add-price: a matching Japanese name is a possible match', () => {
  test('typing the same Japanese name (half-width, no ・) shows "Possible match" with "Use existing"', async ({ page, sanity, trackDoc }) => {
    const jp = uniqueJp()
    const name = testName(`Alphonse Elric Dodoroid ${Date.now()}`)
    const existing = await sanity.create(entry(name, { productNameJp: jp }))
    trackDoc(existing._id)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(testName('Alphonse Elric figure (Good Smile Company)'))
    // The same name in half-width katakana with a space instead of ・.
    const halfWidth = jp.replace('アルフォンス・エルリック', 'ｱﾙﾌｫﾝｽ ｴﾙﾘｯｸ')
    await page.locator('#p-name-jp').fill(halfWidth)

    const row = page.locator('.ap-name-warning-row', { hasText: name })
    await expect(row).toContainText(`Possible match: ${name}`)
    await row.locator('.ap-use-existing-btn').click()
    await expect(page.locator('#p-product')).not.toHaveValue('')
    await expect(page.locator('#p-name')).toHaveValue(name)
  })
})

test.describe('/prices: possible duplicates', () => {
  test('a "Possible duplicate" note on one of the pair; Merge (after confirming) puts all entries in one group', async ({ page, sanity, trackDoc }) => {
    const jp = uniqueJp()
    const jan = uniqueJan()
    const keptName = testName(`Alphonse Elric Dodoroid ${Date.now()}`)
    const mergedName = testName(`Alphonse Elric figure (Good Smile Company) ${Date.now()}`)
    // Kept: the one with a JAN (even though the other has more prices).
    const kept = await sanity.create(entry(keptName, { productNameJp: jp, jan }))
    const m1 = await sanity.create(entry(mergedName, { productNameJp: jp, price: 4800 }))
    const m2 = await sanity.create(entry(mergedName, { productNameJp: jp, price: 4500 }))
    for (const d of [kept, m1, m2]) trackDoc(d._id)

    await page.goto('/prices')
    const keptRow = productRow(page, keptName)
    const mergedRow = productRow(page, mergedName)
    // Once per pair: on the product that would be merged away, naming the kept one.
    await expect(mergedRow.locator('.dup-note')).toContainText(`Possible duplicate of ${keptName}`)
    await expect(keptRow.locator('.dup-note')).toHaveCount(0)

    let confirmText = ''
    page.once('dialog', async (dialog) => {
      confirmText = dialog.message()
      await dialog.accept()
    })
    await mergedRow.locator('.merge-btn').click()
    await expect(page).toHaveURL(/[?&]open=/)
    expect(confirmText).toContain(`Merge "${mergedName}" (2 prices) into "${keptName}"?`)
    expect(confirmText).toContain(`JAN: ${jan}`)
    expect(confirmText).toContain(`Japanese name: ${jp}`)

    // One group: the merged row is gone, the kept row has all three prices (+2).
    await expect(mergedRow).toHaveCount(0)
    await expect(keptRow).toHaveCount(1)
    await expect(keptRow.locator('.summary-more')).toHaveText('+2')
    const after = await sanity.fetch<{ productName: string; jan: string }[]>('*[_id in $ids]{ productName, jan }', { ids: [m1._id, m2._id] })
    expect(after).toEqual([{ productName: keptName, jan }, { productName: keptName, jan }])
  })

  test('cancelling the confirmation changes nothing', async ({ page, sanity, trackDoc }) => {
    const jp = uniqueJp()
    const a = await sanity.create(entry(testName(`Dup Cancel A ${Date.now()}`), { productNameJp: jp }))
    const b = await sanity.create(entry(testName(`Dup Cancel B ${Date.now()}`), { productNameJp: jp }))
    trackDoc(a._id)
    trackDoc(b._id)

    await page.goto('/prices')
    page.once('dialog', (dialog) => dialog.dismiss())
    const btn = page.locator('#product-group-view li.price-row', { hasText: 'Dup Cancel' }).locator('.merge-btn')
    await expect(btn).toHaveCount(1)
    await btn.click()
    await expect(btn).toHaveText('Merge')
    const after = await sanity.fetch<string[]>('*[_id in $ids].productName', { ids: [a._id, b._id] })
    expect(new Set(after).size).toBe(2)
  })

  test('no note for the same Japanese name in different categories', async ({ page, sanity, trackDoc }) => {
    const jp = uniqueJp()
    const figure = await sanity.create(entry(testName(`Dup Category Figure ${Date.now()}`), { productNameJp: jp, category: 'figure' }))
    const game = await sanity.create(entry(testName(`Dup Category Game ${Date.now()}`), { productNameJp: jp, category: 'game' }))
    trackDoc(figure._id)
    trackDoc(game._id)

    await page.goto('/prices')
    const rows = page.locator('#product-group-view li.price-row', { hasText: 'Dup Category' })
    await expect(rows).toHaveCount(2)
    await expect(rows.locator('.dup-note')).toHaveCount(0)
  })
})
