import path from 'node:path'
import { test, expect, testName } from './fixtures'
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

test.describe('add-item: "Who owns it?"', () => {
  test('Kim (the default) still creates a full collection item', async ({ page, trackDoc, sanity }) => {
    await page.goto('/add-item')
    await expect(page.locator('#f-owner')).toHaveValue('Kim')

    const title = testName(`Owner Default Kim ${Date.now()}`)
    await page.locator('#f-type').selectOption('game')
    await page.locator('#f-title').fill(title)
    await page.locator('#f-save').click()

    await expect(page.locator('#f-msg')).toContainText('Saved')
    const id = await sanity.fetch(`*[_type == "game" && title == $title][0]._id`, { title })
    trackDoc(id)
    expect(id).toBeTruthy()
  })

  test('choosing another family member hides collection-only fields and creates a familyItem', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    await page.goto('/add-item')

    await expect(page.locator('div.field', { has: page.locator('#f-year') })).toBeVisible()
    await page.locator('#f-owner').selectOption('Tone')

    // Collection-only fields are gone; the familyItem-only Japanese-name field appears.
    await expect(page.locator('div.field', { has: page.locator('#f-year') })).toBeHidden()
    await expect(page.locator('.field-row', { has: page.locator('#f-yen') })).toBeHidden()
    await expect(page.locator('#f-name-jp-field')).toBeVisible()
    await expect(page.locator('#f-save')).toHaveText('Save family item')

    const name = testName(`Owner Tone Figure ${Date.now()}`)
    await page.locator('#f-type').selectOption('merch')
    await page.locator('#f-title').fill(name)
    await page.locator('#f-name-jp').fill('トーンのフィギュア')
    await page.locator('#f-save').click()

    await expect(page.locator('#f-msg')).toContainText('Saved')
    const doc = await sanity.fetch(`*[_type == "familyItem" && name == $name][0]{ _id, person, nameJp, category }`, { name })
    trackDoc(doc?._id)
    expect(doc?.person).toBe('Tone')
    expect(doc?.nameJp).toBe('トーンのフィギュア')
    expect(doc?.category).toBe('figure')
  })
})

test.describe('add-item: field order, heading and Look up buttons', () => {
  // Same order as /add-price: owner, photo + identify, names, type, barcode + look up, the
  // collection-only fields, notes, Save.
  const ORDER = ['#f-owner', '#f-photo-camera', '#f-identify-btn', '#f-identify-card', '#f-title', '#f-name-jp', '#f-type', '#f-barcode', '#f-dup', '#f-lookups', '#f-category', '#f-platform', '#f-series', '#f-creator', '#f-year', '#f-yen', '#f-date', '#f-notes', '#f-save']

  test('the fields come in /add-price\'s order', async ({ page }) => {
    await page.goto('/add-item')
    const positions = await page.evaluate((selectors) => {
      const all = Array.from(document.querySelectorAll('*'))
      return selectors.map((s) => all.indexOf(document.querySelector(s)!))
    }, ORDER)
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  test('Kim: "Add to collection"; a family member: "Add family item", switching with the owner', async ({ page }) => {
    await page.goto('/add-item')
    await expect(page.getByRole('heading', { name: 'Add to collection' })).toBeVisible()
    await expect(page.locator('#f-intro')).toContainText('identify it, or fill in the name, type and barcode')

    await page.locator('#f-owner').selectOption('Tone')
    await expect(page.getByRole('heading', { name: 'Add family item' })).toBeVisible()
    await expect(page.locator('#f-intro')).toContainText('a family member already has')

    await page.locator('#f-owner').selectOption('Kim')
    await expect(page.getByRole('heading', { name: 'Add to collection' })).toBeVisible()

    await page.goto('/add-item?owner=Niklas') // rendered that way from the start
    await expect(page.getByRole('heading', { name: 'Add family item' })).toBeVisible()
  })

  test('the "Look up" buttons are styled like the page\'s other small buttons, not default white boxes', async ({ page }) => {
    await page.goto('/add-item')
    const lookup = page.locator('#f-lookups button').first()
    await expect(lookup).toHaveText('VGMdb')
    const style = (sel: string) =>
      page.locator(sel).first().evaluate((el) => {
        const cs = getComputedStyle(el)
        return { background: cs.backgroundColor, radius: cs.borderTopLeftRadius, color: cs.color }
      })
    // Same look as "✕ Remove photo" (shown once a photo is chosen).
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await expect(page.locator('#f-photo-remove')).toBeVisible()
    const reference = await style('#f-photo-remove')
    expect(await style('#f-lookups button')).toEqual(reference)
    expect(reference.background).not.toBe('rgb(255, 255, 255)')

    // Re-built when the type changes: still styled.
    await page.locator('#f-type').selectOption('book')
    expect(await style('#f-lookups button')).toEqual(reference)
  })

  test('family member: "Use suggestion" fills name, Japanese name, type and barcode in their new places', async ({ page }) => {
    await mockCheckDuplicate(page, 0)
    await mockIdentifyCustomResult(page, { productName: 'Moogle Plush', productNameJp: 'モーグリ ぬいぐるみ', jan: '4988601111111', category: 'book' })
    await page.goto('/add-item?owner=Tone')
    await page.locator('#f-photo-gallery').setInputFiles(ALBUM_PHOTO)
    await page.locator('#f-identify-btn').click()
    await page.locator('.idf-identify-use-btn').click()

    await expect(page.locator('#f-title')).toHaveValue('Moogle Plush')
    await expect(page.locator('#f-name-jp')).toHaveValue('モーグリ ぬいぐるみ')
    await expect(page.locator('#f-type')).toHaveValue('book')
    await expect(page.locator('#f-barcode')).toHaveValue('4988601111111')
    await expect(page.getByRole('heading', { name: 'Add family item' })).toBeVisible() // still a family item
    await expect(page.locator('#f-save')).toHaveText('Save family item')
  })
})

test.describe('add-item: Kim\'s Final Fantasy collection vs "other things"', () => {
  test('the owner options: Kim – Final Fantasy collection (default), Kim – other things, then the family', async ({ page }) => {
    await page.goto('/add-item')
    await expect(page.locator('#f-owner option')).toHaveText(['Kim – Final Fantasy collection', 'Kim – other things', 'Tone', 'Niklas', 'Kristina', 'Richard'])
    await expect(page.locator('#f-owner')).toHaveValue('Kim')
    await expect(page.getByRole('heading', { name: 'Add to collection' })).toBeVisible()
    await expect(page.locator('div.field', { has: page.locator('#f-year') })).toBeVisible()
  })

  test('"Kim – other things" saves a familyItem for Kim, with the simple fields and its own heading', async ({ page, sanity, trackDoc }) => {
    await page.goto('/add-item')
    await page.locator('#f-owner').selectOption('Kim-other')
    await expect(page.getByRole('heading', { name: 'Add to my other things' })).toBeVisible()
    await expect(page.locator('#f-owner-hint')).toContainText('one of your other things')
    await expect(page.locator('div.field', { has: page.locator('#f-year') })).toBeHidden()
    await expect(page.locator('#f-name-jp-field')).toBeVisible()
    await expect(page.locator('#f-save')).toHaveText('Save to other things')
    await expect(page.locator('#f-back')).toHaveAttribute('href', '/family?person=Kim-other')

    const name = testName(`Gundam RX-78-2 ${Date.now()}`)
    await page.locator('#f-type').selectOption('merch')
    await page.locator('#f-title').fill(name)
    await page.locator('#f-name-jp').fill('ガンダム')
    await page.locator('#f-save').click()
    await expect(page.locator('#f-msg')).toContainText('Saved')

    const doc = await sanity.fetch(`*[_type == "familyItem" && name == $name][0]{ _id, person, nameJp, category }`, { name })
    trackDoc(doc?._id)
    expect(doc).toMatchObject({ person: 'Kim', nameJp: 'ガンダム', category: 'figure' })
    // Not a collection item.
    expect(await sanity.fetch(`count(*[_type in ["album", "game", "book", "figure"] && title == $name])`, { name })).toBe(0)
  })

  test('?owner=Kim-other preselects "Kim – other things"', async ({ page }) => {
    await page.goto('/add-item?owner=Kim-other')
    await expect(page.locator('#f-owner')).toHaveValue('Kim-other')
    await expect(page.getByRole('heading', { name: 'Add to my other things' })).toBeVisible()
    await expect(page.locator('#f-owner-hint')).toBeVisible()
  })

  test('a family member still gets "Add family item" and a familyItem for that person', async ({ page }) => {
    await page.goto('/add-item?owner=Richard')
    await expect(page.locator('#f-owner')).toHaveValue('Richard')
    await expect(page.getByRole('heading', { name: 'Add family item' })).toBeVisible()
    await expect(page.locator('#f-owner-hint')).toContainText('Saved as a family item')
    await expect(page.locator('#f-save')).toHaveText('Save family item')
  })
})
