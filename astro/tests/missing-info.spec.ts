import { test, expect, testName, uniqueJan } from './fixtures'

test.describe('missing-info: list page', () => {
  test('shows an item missing an important field, with the specific fields named', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Missing Game ${Date.now()}`)
    // No platform/year/developer — all three of game's important fields are missing.
    const game = await sanity.create({ _type: 'game', title, status: 'owned' })
    trackDoc(game._id)

    await page.goto('/missing-info')
    const row = page.locator('.missing-row', { hasText: title })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Game')
    await expect(row).toContainText('platform')
    await expect(row).toContainText('year')
    await expect(row).toContainText('developer')
  })

  test('a flagged (needsInfo) item with every important field present still appears, tagged "Flagged"', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const title = testName(`Flagged Complete Figure ${Date.now()}`)
    const figure = await sanity.create({
      _type: 'figure', title, manufacturer: 'Good Smile Company', series: 'Final Fantasy', needsInfo: true, status: 'owned',
    })
    trackDoc(figure._id)

    await page.goto('/missing-info')
    const row = page.locator('.missing-row', { hasText: title })
    await expect(row).toBeVisible()
    await expect(row.locator('.flagged-tag')).toHaveText('Flagged')
    await expect(row.locator('.missing-fields')).toHaveCount(0)
  })

  test('a fully complete, unflagged item does not appear', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Fully Complete Figure ${Date.now()}`)
    const figure = await sanity.create({
      _type: 'figure', title, manufacturer: 'Good Smile Company', series: 'Final Fantasy', status: 'owned',
    })
    trackDoc(figure._id)

    await page.goto('/missing-info')
    await expect(page.locator('.missing-row', { hasText: title })).toHaveCount(0)
  })

  test('the album OR-group (artist or composer) is satisfied by either field alone', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Album Has Composer Only ${Date.now()}`)
    const album = await sanity.create({
      _type: 'album', title, composer: 'Nobuo Uematsu', barcode: uniqueJan(), catalogNumber: 'SQEX-1', releaseDate: '2020', status: 'owned',
    })
    trackDoc(album._id)

    await page.goto('/missing-info')
    // Complete per IMPORTANT_FIELDS.album (composer alone satisfies the artist-or-composer
    // group) and not flagged, so it shouldn't appear at all.
    await expect(page.locator('.missing-row', { hasText: title })).toHaveCount(0)
  })

  test('type chips filter the list', async ({ page, trackDoc, sanity }) => {
    const gameTitle = testName(`Filter Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title: gameTitle, status: 'owned' })
    trackDoc(game._id)
    const bookTitle = testName(`Filter Book ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title: bookTitle, author: 'Jane Doe', status: 'owned' })
    trackDoc(book._id)

    await page.goto('/missing-info')
    await expect(page.locator('.missing-row', { hasText: gameTitle })).toBeVisible()
    await expect(page.locator('.missing-row', { hasText: bookTitle })).toBeVisible()

    await page.locator('#type-filter .chip', { hasText: 'Game' }).click()
    await expect(page.locator('.missing-row', { hasText: gameTitle })).toBeVisible()
    await expect(page.locator('.missing-row', { hasText: bookTitle })).toBeHidden()
  })

  test('"Only flagged" toggle shows only needsInfo items', async ({ page, trackDoc, sanity }) => {
    const flaggedTitle = testName(`Only Flagged Game ${Date.now()}`)
    const flagged = await sanity.create({ _type: 'game', title: flaggedTitle, needsInfo: true, platform: 'PS5', year: 2020, developer: 'X', status: 'owned' })
    trackDoc(flagged._id)
    const unflaggedTitle = testName(`Only Flagged Unflagged Book ${Date.now()}`)
    const unflagged = await sanity.create({ _type: 'book', title: unflaggedTitle, status: 'owned' })
    trackDoc(unflagged._id)

    await page.goto('/missing-info')
    await expect(page.locator('.missing-row', { hasText: flaggedTitle })).toBeVisible()
    await expect(page.locator('.missing-row', { hasText: unflaggedTitle })).toBeVisible()

    await page.locator('#flag-filter .chip', { hasText: 'Only flagged' }).click()
    await expect(page.locator('.missing-row', { hasText: flaggedTitle })).toBeVisible()
    await expect(page.locator('.missing-row', { hasText: unflaggedTitle })).toBeHidden()
  })

  test('a row links into the item\'s edit mode via ?edit=1', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Missing Info Link Book ${Date.now()}`)
    const book = await sanity.create({ _type: 'book', title, status: 'owned' })
    trackDoc(book._id)

    await page.goto('/missing-info')
    const row = page.locator('.missing-row', { hasText: title })
    await expect(row).toHaveAttribute('href', `/books/${book._id}?edit=1`)

    await row.click()
    await expect(page).toHaveURL(`/books/${book._id}?edit=1`)
    await expect(page.locator('#edit-mode')).toBeVisible()
    await expect(page.locator('#view-mode')).toBeHidden()
  })
})

test.describe('missing-info: entry points', () => {
  test('add-menu.astro links to /missing-info', async ({ page }) => {
    await page.goto('/add-menu')
    const card = page.locator('a.menu-card').filter({ has: page.locator('.menu-title', { hasText: /^Missing info$/ }) })
    await expect(card).toHaveAttribute('href', '/missing-info')
  })

  test('games index shows an "items need info" banner linking to /missing-info', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Index Banner Game ${Date.now()}`)
    const game = await sanity.create({ _type: 'game', title, status: 'owned' })
    trackDoc(game._id)

    await page.goto('/games')
    const banner = page.locator('.missing-info-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('href', '/missing-info')
  })

  test('albums index shows the needsInfo badge', async ({ page, trackDoc, sanity }) => {
    const title = testName(`Album NeedsInfo Badge ${Date.now()}`)
    const album = await sanity.create({ _type: 'album', title, needsInfo: true, status: 'owned' })
    trackDoc(album._id)

    await page.goto('/albums')
    const row = page.locator('.album-row-wrap', { hasText: title })
    await expect(row.locator('.needsinfo-tag')).toHaveText('MISSING INFO')
  })
})
