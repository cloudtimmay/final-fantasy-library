import { test, expect, testName } from './fixtures'

test.describe('collection detail pages: needsInfo banner', () => {
  test('album detail page shows a needsInfo banner with the barcode when flagged', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Needs Info Album ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, needsInfo: true, barcode: '4988601234567', status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await expect(page.locator('.needsinfo-banner')).toBeVisible()
    await expect(page.locator('.needsinfo-banner')).toContainText('4988601234567')
  })

  test('album detail page shows no banner when needsInfo is not set', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Complete Album ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await expect(page.locator('.needsinfo-banner')).toHaveCount(0)
  })
})

test.describe('games/[id]: edit mode', () => {
  test('Edit reveals a form prefilled with the current values', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Prefill Game ${Date.now()}`)
    const game = await sanity.create({
      _type: 'game', title, platform: 'PS5', genre: 'RPG', developer: 'Square Enix',
      publisher: 'Square Enix', year: 2020, barcode: '4988601111111', status: 'owned',
    })
    trackDoc(game._id)

    await page.goto(`/games/${game._id}`)
    await expect(page.locator('#edit-mode')).toBeHidden()
    await page.locator('#edit-toggle').click()
    await expect(page.locator('#edit-mode')).toBeVisible()

    await expect(page.locator('#e-title')).toHaveValue(title)
    await expect(page.locator('#e-platform')).toHaveValue('PS5')
    await expect(page.locator('#e-genre')).toHaveValue('RPG')
    await expect(page.locator('#e-developer')).toHaveValue('Square Enix')
    await expect(page.locator('#e-year')).toHaveValue('2020')
    await expect(page.locator('#e-barcode')).toHaveValue('4988601111111')
  })

  test('Save updates the document and the view reflects it after reload', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Save Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, status: 'owned' })
    trackDoc(game._id)

    const newTitle = testName(`Edit Save Game Renamed ${Date.now()}`)
    await page.goto(`/games/${game._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-title').fill(newTitle)
    await page.locator('#e-platform').selectOption('SWITCH')
    await page.locator('#e-genre').selectOption('Adventure')
    await page.locator('#e-developer').fill('Nintendo')
    await page.locator('#e-year').fill('2017')
    await page.locator('#e-completion').selectOption('playing')
    await page.locator('#e-needs-info').check()
    await page.locator('#e-save').click()

    await expect(page.locator('.detail h1')).toHaveText(newTitle)
    await expect(page.locator('#edit-mode')).toBeHidden()
    await expect(page.locator('.needsinfo-banner')).toBeVisible()

    const doc = await sanity.fetch(`*[_id == $id][0]{ title, platform, genre, developer, year, completionStatus, needsInfo }`, { id: game._id })
    expect(doc.title).toBe(newTitle)
    expect(doc.platform).toBe('SWITCH')
    expect(doc.genre).toBe('Adventure')
    expect(doc.developer).toBe('Nintendo')
    expect(doc.year).toBe(2017)
    expect(doc.completionStatus).toBe('playing')
    expect(doc.needsInfo).toBe(true)
  })

  test('clearing a field actually unsets it, not just leaves it blank client-side', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Clear Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, barcode: '4988602222222', status: 'owned' })
    trackDoc(game._id)

    await page.goto(`/games/${game._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-barcode').fill('')
    await page.locator('#e-save').click()
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ barcode }`, { id: game._id })
    expect(doc.barcode).toBeNull()
  })

  test('Cancel discards unsaved changes', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Cancel Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, status: 'owned' })
    trackDoc(game._id)

    await page.goto(`/games/${game._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-title').fill('Something I will not save')
    await page.locator('#e-cancel').click()

    await expect(page.locator('#edit-mode')).toBeHidden()
    await expect(page.locator('.detail h1')).toHaveText(title)

    await page.locator('#edit-toggle').click()
    await expect(page.locator('#e-title')).toHaveValue(title)

    const doc = await sanity.fetch(`*[_id == $id][0]{ title }`, { id: game._id })
    expect(doc.title).toBe(title)
  })

  test('rejects an empty title without saving', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Empty Title Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, status: 'owned' })
    trackDoc(game._id)

    await page.goto(`/games/${game._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-title').fill('')
    await page.locator('#e-save').click()

    await expect(page.locator('#e-msg')).toContainText('title')
    await expect(page.locator('#edit-mode')).toBeVisible()
  })
})

test.describe('books/[id]: edit mode', () => {
  test('Edit reveals a prefilled form, Save updates the document', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Book ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title, author: 'Jane Doe', status: 'owned' })
    trackDoc(book._id)

    await page.goto(`/books/${book._id}`)
    await page.locator('#edit-toggle').click()
    await expect(page.locator('#e-title')).toHaveValue(title)
    await expect(page.locator('#e-author')).toHaveValue('Jane Doe')

    await page.locator('#e-author').fill('John Smith')
    await page.locator('#e-genre').selectOption('Fantasy')
    await page.locator('#e-language').selectOption('Japanese')
    await page.locator('#e-read-status').selectOption('read')
    await page.locator('#e-isbn').fill('9784001234567')
    await page.locator('#e-save').click()

    await expect(page.locator('.detail h1')).toHaveText(title)
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ author, genre, language, readStatus, isbn }`, { id: book._id })
    expect(doc.author).toBe('John Smith')
    expect(doc.genre).toBe('Fantasy')
    expect(doc.language).toBe('Japanese')
    expect(doc.readStatus).toBe('read')
    expect(doc.isbn).toBe('9784001234567')
  })

  test('requires both title and author', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Book Required ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title, author: 'Jane Doe', status: 'owned' })
    trackDoc(book._id)

    await page.goto(`/books/${book._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-author').fill('')
    await page.locator('#e-save').click()

    await expect(page.locator('#e-msg')).toContainText('author')
    await expect(page.locator('#edit-mode')).toBeVisible()
  })

  test('clearing the publisher unsets it', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Book Clear ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title, author: 'Jane Doe', publisher: 'Square Enix Books', status: 'owned' })
    trackDoc(book._id)

    await page.goto(`/books/${book._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-publisher').fill('')
    await page.locator('#e-save').click()
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ publisher }`, { id: book._id })
    expect(doc.publisher).toBeNull()
  })
})

test.describe('merchandise/[id]: edit mode', () => {
  test('Edit reveals a prefilled form, Save updates the document', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Figure ${Date.now()}`)
    const figure = await sanity.create({ _type: 'figure', title, category: 'figure', status: 'owned' })
    trackDoc(figure._id)

    await page.goto(`/merchandise/${figure._id}`)
    await page.locator('#edit-toggle').click()
    await expect(page.locator('#e-title')).toHaveValue(title)
    await expect(page.locator('#e-category')).toHaveValue('figure')

    await page.locator('#e-category').selectOption('plushie')
    await page.locator('#e-manufacturer').fill('Square Enix')
    await page.locator('#e-scale').fill('1/7')
    await page.locator('#e-barcode').fill('4988603333333')
    await page.locator('#e-save').click()

    await expect(page.locator('.detail h1')).toHaveText(title)
    await expect(page.locator('#edit-mode')).toBeHidden()
    await expect(page.locator('.meta-table')).toContainText('4988603333333')

    const doc = await sanity.fetch(`*[_id == $id][0]{ category, manufacturer, scale, barcode }`, { id: figure._id })
    expect(doc.category).toBe('plushie')
    expect(doc.manufacturer).toBe('Square Enix')
    expect(doc.scale).toBe('1/7')
    expect(doc.barcode).toBe('4988603333333')
  })

  test('rejects an empty title without saving', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Figure Required ${Date.now()}`)
    const figure = await sanity.create({ _type: 'figure', title, status: 'owned' })
    trackDoc(figure._id)

    await page.goto(`/merchandise/${figure._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-title').fill('')
    await page.locator('#e-save').click()

    await expect(page.locator('#e-msg')).toContainText('title')
    await expect(page.locator('#edit-mode')).toBeVisible()
  })

  test('clearing the manufacturer unsets it', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Figure Clear ${Date.now()}`)
    const figure = await sanity.create({ _type: 'figure', title, manufacturer: 'Good Smile Company', status: 'owned' })
    trackDoc(figure._id)

    await page.goto(`/merchandise/${figure._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-manufacturer').fill('')
    await page.locator('#e-save').click()
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ manufacturer }`, { id: figure._id })
    expect(doc.manufacturer).toBeNull()
  })
})

test.describe('albums/[id]: edit mode', () => {
  test('an album with no tracklist still gets a working Edit button', async ({ page, trackDoc, sanity }) => {
    // Regression test: closeBtn.addEventListener() used to run unguarded even when the
    // album has no tracklist (so #yt-close doesn't exist), throwing and skipping every
    // script after it on the page — including the new edit-mode wiring.
    const title = testName(`No Tracklist Album ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await expect(page.locator('.tracklist')).toHaveCount(0)
    await page.locator('#edit-toggle').click()
    await expect(page.locator('#edit-mode')).toBeVisible()
  })

  test('Edit reveals a prefilled form, Save updates the document (tracklist stays untouched)', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const title = testName(`Edit Album ${Date.now()}`)
    const album = await sanity.create({
      _type: 'album', title, artist: 'Nobuo Uematsu', format: 'cd', status: 'owned',
      tracklist: [{ _key: 't1', trackNumber: '1', title: 'Opening Theme' }],
    })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await page.locator('#edit-toggle').click()
    await expect(page.locator('#e-title')).toHaveValue(title)
    await expect(page.locator('#e-artist')).toHaveValue('Nobuo Uematsu')
    await expect(page.locator('#e-format')).toHaveValue('cd')

    await page.locator('#e-genre').selectOption('Soundtrack')
    await page.locator('#e-format').selectOption('vinyl_lp')
    await page.locator('#e-label').fill('Square Enix Music')
    await page.locator('#e-catalog').fill('SQEX-10130')
    await page.locator('#e-vgmdb-url').fill('https://vgmdb.net/album/1')
    await page.locator('#e-save').click()

    await expect(page.locator('.detail h1')).toHaveText(title)
    await expect(page.locator('#edit-mode')).toBeHidden()
    await expect(page.locator('.tracklist')).toContainText('Opening Theme')

    const doc = await sanity.fetch(
      `*[_id == $id][0]{ genre, format, label, catalogNumber, vgmdbUrl, "trackCount": count(tracklist) }`,
      { id: album._id }
    )
    expect(doc.genre).toBe('Soundtrack')
    expect(doc.format).toBe('vinyl_lp')
    expect(doc.label).toBe('Square Enix Music')
    expect(doc.catalogNumber).toBe('SQEX-10130')
    expect(doc.vgmdbUrl).toBe('https://vgmdb.net/album/1')
    expect(doc.trackCount).toBe(1)
  })

  test('rejects an empty title without saving', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Album Required ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-title').fill('')
    await page.locator('#e-save').click()

    await expect(page.locator('#e-msg')).toContainText('title')
    await expect(page.locator('#edit-mode')).toBeVisible()
  })

  test('clearing the label unsets it', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Edit Album Clear ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, label: 'Some Label', status: 'owned' })
    trackDoc(album._id)

    await page.goto(`/albums/${album._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-label').fill('')
    await page.locator('#e-save').click()
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ label }`, { id: album._id })
    expect(doc.label).toBeNull()
  })
})
