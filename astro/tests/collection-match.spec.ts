import path from 'node:path'
import { test, expect, testName } from './fixtures'
import { mockIdentifyCustomResult } from './helpers/mock-ai'
import { normalizeCode, codesMatch, isbn10ToIsbn13, normalizeForMatch, findCollectionMatches, isOwnedStatus } from '../src/lib/product-match'
import { validateIdentifyResult } from '../src/lib/identify-result'

const ALBUM_PHOTO = path.join(__dirname, '..', 'public', 'icons', 'album.png')

// A fresh, valid ISBN pair per call — 9 random digits, then the ISBN-10 check digit (may be
// X) and the matching ISBN-13 — so a fixture can't collide with a real book in the dataset.
function randomIsbn(): { isbn10: string; isbn13: string } {
  const core = '9' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i)
  const check = (11 - (sum % 11)) % 11
  const isbn10 = core + (check === 10 ? 'X' : String(check))
  return { isbn10, isbn13: isbn10ToIsbn13(isbn10) }
}
const hyphenate10 = (s: string) => `${s[0]}-${s.slice(1, 6)}-${s.slice(6, 9)}-${s[9]}`

test.describe('collection matching: codes', () => {
  test('ISBN-10 and hyphenated ISBN-13 normalize to the same ISBN-13', () => {
    // The real "Art of Final Fantasy XVI" in the dataset: isbn 9781646092369.
    expect(normalizeCode('1-64609-236-8')).toBe('9781646092369')
    expect(normalizeCode('978-1-64609-236-9')).toBe('9781646092369')
    expect(codesMatch('1646092368', '9781646092369')).toBe(true)
    expect(normalizeCode('080442957X')).toBe('9780804429573')
  })

  test('a 12-digit UPC matches the 13-digit EAN a scanner may read', () => {
    expect(codesMatch('045496590420', '0045496590420')).toBe(true)
    expect(codesMatch('4988601234567', '4988601234568')).toBe(false)
    expect(codesMatch('', '')).toBe(false)
  })

  test('identify keeps an ISBN-10 as its ISBN-13', () => {
    expect(validateIdentifyResult({ jan: '1-64609-236-8' }).jan).toBe('9781646092369')
    expect(validateIdentifyResult({ jan: '4988601234567' }).jan).toBe('4988601234567')
  })

  test('a book matches on isbn, other types on barcode', () => {
    const items = [
      { _id: 'b1', _type: 'book', title: 'Some Book', isbn: '978-1-64609-236-9', barcode: null },
      { _id: 'a1', _type: 'album', title: 'Some Album', barcode: '4988601234567' },
      { _id: 'b2', _type: 'book', title: 'Barcode-only Book', barcode: '4988601234567' },
    ]
    expect(findCollectionMatches(items, { jan: '1646092368' }).map((m) => [m.item._id, m.label])).toEqual([['b1', 'Same barcode']])
    expect(findCollectionMatches(items, { jan: '4988601234567' }).map((m) => m.item._id)).toEqual(['a1'])
  })
})

test.describe('collection matching: names', () => {
  const book = (title: string) => [{ _id: 'x', _type: 'book', title }]
  const matches = (title: string, identified: Parameters<typeof findCollectionMatches>[1]) => findCollectionMatches(book(title), identified).length > 0

  test('a leading "The" is ignored', () => {
    expect(normalizeForMatch('The Art of Final Fantasy XVI')).toBe(normalizeForMatch('Art of Final Fantasy XVI'))
    expect(matches('Art of Final Fantasy XVI', { productName: 'The Art of Final Fantasy XVI' })).toBe(true)
  })

  test('"Vol. 1" / "Volume 1" / "1" are the same, but volume 2 is not volume 1', () => {
    expect(matches('Final Fantasy Ultimania Archive Volume 1', { productName: 'Final Fantasy Ultimania Archive Vol. 1' })).toBe(true)
    expect(matches('Final Fantasy Ultimania Archive Volume 1', { productName: 'Final Fantasy Ultimania Archive 1' })).toBe(true)
    expect(matches('Final Fantasy Ultimania Archive Volume 1', { productName: 'Final Fantasy Ultimania Archive Vol. 2' })).toBe(false)
  })

  test('a subtitle after ":" on one side still matches; two different subtitles do not', () => {
    expect(matches('Final Fantasy VII Remake: World Preview', { productName: 'Final Fantasy VII Remake World Preview' })).toBe(true)
    expect(matches('Final Fantasy XVI: The Complete Guide', { productName: 'Final Fantasy XVI The Complete Guide' })).toBe(true)
    expect(matches('Final Fantasy VII Remake: World Preview', { productName: 'Final Fantasy VII Remake: Material Ultimania' })).toBe(false)
  })

  test('whole words only: "Final Fantasy XV" and "Final Fantasy X" do not match "... XVI"', () => {
    expect(matches('The art of Final Fantasy XV', { productName: 'The Art of Final Fantasy XVI' })).toBe(false)
    expect(matches('Final Fantasy X', { productName: 'The Art of Final Fantasy XVI' })).toBe(false)
    expect(matches('Final Fantasy XVI', { productName: 'The Art of Final Fantasy XVI' })).toBe(true)
    // A single ASCII word is never enough for a containment match.
    expect(matches('Final Fantasy XVI', { productName: 'Fantasy' })).toBe(false)
  })

  test('best match first: equal, then a title containing the name, then a shorter title', () => {
    const items = [
      { _id: 'short', _type: 'game', title: 'Final Fantasy XVI' },
      { _id: 'longer', _type: 'book', title: 'The Art of Final Fantasy XVI Deluxe Edition' },
      { _id: 'equal', _type: 'book', title: 'Art of Final Fantasy XVI' },
    ]
    expect(findCollectionMatches(items, { productName: 'The Art of Final Fantasy XVI' }).map((m) => m.item._id)).toEqual(['equal', 'longer', 'short'])
  })

  test('the identified Japanese name is compared against the title too', () => {
    expect(matches('ファイナルファンタジーXVI アートブック', { productName: 'Final Fantasy XVI Artbook', productNameJp: 'ファイナルファンタジーXVI アートブック' })).toBe(true)
  })

  test('no status counts as owned; wishlist and sold do not', () => {
    expect(isOwnedStatus(undefined)).toBe(true)
    expect(isOwnedStatus(null)).toBe(true)
    expect(isOwnedStatus('owned')).toBe(true)
    expect(isOwnedStatus('lent')).toBe(true)
    expect(isOwnedStatus('wishlist')).toBe(false)
    expect(isOwnedStatus('sold')).toBe(false)
  })
})

async function identifyOnScan(page: import('@playwright/test').Page, result: Record<string, unknown>) {
  await mockIdentifyCustomResult(page, result)
  await page.goto('/scan')
  await Promise.all([page.waitForURL(/\/scan\?/), page.locator('#scan-photo-gallery').setInputFiles(ALBUM_PHOTO)])
}

test.describe('scan: identify by photo finds an owned book', () => {
  test('by title variant ("The Art of ..." vs stored "Art of ..."), with no status set', async ({ page, sanity, trackDoc }) => {
    const suffix = String(Date.now())
    const book = await sanity.create({ _type: 'book', title: testName(`Art of Final Fantasy XVI ${suffix}`), author: 'Square Enix' })
    trackDoc(book._id)

    await identifyOnScan(page, { productName: `The Art of Final Fantasy XVI ${suffix}`, category: 'book', jan: null })

    const row = page.locator('a.result-row', { hasText: suffix })
    await expect(row).toHaveAttribute('href', `/books/${book._id}`)
    await expect(row.locator('.match-badge')).toHaveText('Similar name')
    await expect(row.locator('.badge.owned')).toBeVisible()
    await expect(page.locator('.dup-banner')).toContainText(suffix)
  })

  test('by ISBN-10 read off the book, against a hyphenated stored ISBN-13', async ({ page, sanity, trackDoc }) => {
    const { isbn10, isbn13 } = randomIsbn()
    const stored = `${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 9)}-${isbn13.slice(9, 12)}-${isbn13.slice(12)}`
    const title = testName(`ISBN Book ${isbn13}`)
    const book = await sanity.create({ _type: 'book', title, author: 'Square Enix', isbn: stored, status: 'owned' })
    trackDoc(book._id)

    await identifyOnScan(page, { productName: `Completely different name ${Date.now()}`, category: 'book', jan: hyphenate10(isbn10) })

    const row = page.locator('a.result-row', { hasText: isbn13 })
    await expect(row).toHaveAttribute('href', `/books/${book._id}`)
    await expect(row.locator('.match-badge')).toHaveText('Same barcode')
  })
})

test.describe('add-price: "You already have this in your collection"', () => {
  test('flags an owned book by title variant, with a link to it', async ({ page, sanity, trackDoc }) => {
    const suffix = String(Date.now())
    const book = await sanity.create({ _type: 'book', title: testName(`Art of Final Fantasy XVI ${suffix}`), author: 'Square Enix' })
    trackDoc(book._id)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(`The Art of Final Fantasy XVI ${suffix}`)

    const note = page.locator('#p-owned-note')
    await expect(note).toContainText('You already have this in your collection')
    // The real "Art of Final Fantasy XVI" (and the FFXVI game) in the dataset match too —
    // what matters is that this one is listed, and ranked first as the closest title.
    await expect(note.locator('.ap-owned-note-link').first()).toHaveAttribute('href', `/books/${book._id}`)
    await expect(note.locator('.ap-owned-note-link', { hasText: /^The art of Final Fantasy XV$/ })).toHaveCount(0)
  })

  test('flags an owned book by ISBN, shown alongside the family note', async ({ page, sanity, trackDoc }) => {
    const { isbn10, isbn13 } = randomIsbn()
    const book = await sanity.create({ _type: 'book', title: testName(`ISBN Book ${isbn13}`), author: 'Square Enix', isbn: isbn13, status: 'owned' })
    trackDoc(book._id)
    const item = await sanity.create({ _type: 'familyItem', name: testName(`Family copy ${isbn13}`), person: 'Tone', jan: isbn13 })
    trackDoc(item._id)

    await page.goto('/add-price')
    await page.locator('#p-name').fill(`Unrelated name ${Date.now()}`)
    await page.locator('#p-jan').fill(isbn10)

    const note = page.locator('#p-owned-note')
    await expect(note).toContainText('You already have this in your collection')
    await expect(note.locator(`.ap-owned-note-link[href="/books/${book._id}"]`)).toBeVisible()
    await expect(note).toContainText('Same barcode')
    await expect(note).toContainText('Tone already has this')
  })

  test('a wishlist item is not flagged as already owned', async ({ page, sanity, trackDoc }) => {
    const title = testName(`Wishlist only ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, status: 'wishlist' })
    trackDoc(album._id)

    // A fake clock instead of a fixed wait: advancing it past the 300 ms debounce makes the
    // check run for certain before asserting that it found nothing.
    await page.clock.install()
    await page.goto('/add-price')
    await page.locator('#p-name').fill(title)
    await page.clock.runFor(400)
    await expect(page.locator('#p-owned-note')).not.toContainText('You already have this')
  })
})
