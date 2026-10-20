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
