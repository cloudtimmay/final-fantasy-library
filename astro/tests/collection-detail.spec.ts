import { test, expect, testName } from './fixtures'
import { mockItemInfoResult, mockItemInfoEmpty } from './helpers/mock-ai'

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

test.describe('games/[id]: "Fill in from web"', () => {
  test('suggests only the fields with a value, checked by default only when empty, applies on request', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const title = testName(`AI Fill Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, developer: 'Square Enix', status: 'owned' })
    trackDoc(game._id)

    await mockItemInfoResult(page, {
      genre: 'RPG',
      platform: 'PS5',
      developer: 'Square Enix Co.',
      publisher: 'Square Enix',
      year: 2023,
      externalImageUrl: 'https://example-source.test/cover.jpg',
    })

    await page.goto(`/games/${game._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-ai-fill-btn').click()

    const card = page.locator('.aif-card')
    await expect(card).toBeVisible()

    // "Developer" already has a value ("Square Enix") — unchecked by default. Everything
    // else was empty — checked by default.
    const devRow = page.locator('.aif-item', { hasText: 'Developer' })
    await expect(devRow.locator('.aif-checkbox')).not.toBeChecked()
    const genreRow = page.locator('.aif-item', { hasText: 'Genre' })
    await expect(genreRow.locator('.aif-checkbox')).toBeChecked()
    const platformRow = page.locator('.aif-item', { hasText: 'Platform' })
    await expect(platformRow.locator('.aif-checkbox')).toBeChecked()

    // Check "Developer" too (so applying also overwrites an already-filled field), and
    // uncheck "Platform" (so applying proves an unchecked field is left alone).
    await devRow.locator('.aif-checkbox').check()
    await platformRow.locator('.aif-checkbox').uncheck()
    await page.locator('.aif-apply-btn').click()

    await expect(page.locator('#e-genre')).toHaveValue('RPG')
    await expect(page.locator('#e-platform')).toHaveValue('')
    await expect(page.locator('#e-developer')).toHaveValue('Square Enix Co.')
    await expect(page.locator('#e-external-image')).toHaveValue('https://example-source.test/cover.jpg')
    // Publisher was empty too, so it was also checked by default and applied.
    await expect(page.locator('#e-publisher')).toHaveValue('Square Enix')

    await page.locator('#e-save').click()
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ genre, platform, developer, publisher, externalImageUrl }`, { id: game._id })
    expect(doc.genre).toBe('RPG')
    expect(doc.platform).toBeNull()
    expect(doc.developer).toBe('Square Enix Co.')
    expect(doc.publisher).toBe('Square Enix')
    expect(doc.externalImageUrl).toBe('https://example-source.test/cover.jpg')
  })

  test('shows a message when nothing reliable is found', async ({ page, trackDoc, sanity }) => {
    const title = testName(`AI Fill Game Empty ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, status: 'owned' })
    trackDoc(game._id)

    await mockItemInfoEmpty(page)
    await page.goto(`/games/${game._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-ai-fill-btn').click()

    await expect(page.locator('#e-ai-fill-msg')).toContainText('Nothing reliable found')
    await expect(page.locator('.aif-card')).toHaveCount(0)
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

test.describe('books/[id]: "Fill in from web"', () => {
  test('ISBN is always unchecked by default and shows a source, even though it was empty', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const title = testName(`AI Fill Book ISBN ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title, author: 'Jane Doe', status: 'owned' })
    trackDoc(book._id)

    await mockItemInfoResult(
      page,
      { genre: 'Fiction', isbn: '9784001234567' },
      [{ title: 'Example Books Source', url: 'https://books.example.test/isbn/9784001234567' }]
    )

    await page.goto(`/books/${book._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-ai-fill-btn').click()

    const isbnRow = page.locator('.aif-item', { hasText: 'ISBN' })
    await expect(isbnRow).toBeVisible()
    await expect(isbnRow.locator('.aif-checkbox')).not.toBeChecked()
    await expect(isbnRow).toContainText('books.example.test')

    // A normal (non-barcode-like) field, also empty, is checked by default for contrast.
    const genreRow = page.locator('.aif-item', { hasText: 'Genre' })
    await expect(genreRow.locator('.aif-checkbox')).toBeChecked()

    await page.locator('.aif-apply-btn').click()
    await expect(page.locator('#e-genre')).toHaveValue('Fiction')
    await expect(page.locator('#e-isbn')).toHaveValue('')
  })

  test('applies selected suggestions and saves them', async ({ page, trackDoc, sanity }) => {
    const title = testName(`AI Fill Book ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title, author: 'Jane Doe', status: 'owned' })
    trackDoc(book._id)

    await mockItemInfoResult(page, {
      genre: 'Fantasy',
      publisher: 'Square Enix Books',
      year: 2021,
      pages: 320,
      language: 'Japanese',
      isbn: '9784001234567',
      externalImageUrl: 'https://example-source.test/cover.jpg',
    })

    await page.goto(`/books/${book._id}`)
    await page.locator('#edit-toggle').click()
    await page.locator('#e-ai-fill-btn').click()
    await page.locator('.aif-item', { hasText: 'ISBN' }).locator('.aif-checkbox').check()
    await page.locator('.aif-apply-btn').click()

    await expect(page.locator('#e-genre')).toHaveValue('Fantasy')
    await expect(page.locator('#e-publisher')).toHaveValue('Square Enix Books')
    await expect(page.locator('#e-year')).toHaveValue('2021')
    await expect(page.locator('#e-pages')).toHaveValue('320')
    await expect(page.locator('#e-language')).toHaveValue('Japanese')
    await expect(page.locator('#e-isbn')).toHaveValue('9784001234567')
    await expect(page.locator('#e-external-image')).toHaveValue('https://example-source.test/cover.jpg')

    await page.locator('#e-save').click()
    await expect(page.locator('#edit-mode')).toBeHidden()

    const doc = await sanity.fetch(`*[_id == $id][0]{ genre, publisher, year, pages, language, isbn, externalImageUrl }`, { id: book._id })
    expect(doc.genre).toBe('Fantasy')
    expect(doc.publisher).toBe('Square Enix Books')
    expect(doc.year).toBe(2021)
    expect(doc.pages).toBe(320)
    expect(doc.language).toBe('Japanese')
    expect(doc.isbn).toBe('9784001234567')
    expect(doc.externalImageUrl).toBe('https://example-source.test/cover.jpg')
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
