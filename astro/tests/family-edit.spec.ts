import { test, expect, testName } from './fixtures'
import { PERSON, OTHER, PHOTO, famRow, familyItem } from './helpers/family'

test.describe('/edit-family-item', () => {
  test('tapping a family item opens its form; saving updates it', async ({ page, sanity, trackDoc }) => {
    const item = await familyItem(sanity, trackDoc, { nameJp: '古い名前', jan: '4900000000000', category: 'book', note: 'Old note' })
    await page.goto(`/family?person=${PERSON}`)
    await famRow(page, item.name).locator('.fam-name').click()
    await expect(page).toHaveURL(`/edit-family-item?id=${item._id}`)
    await expect(page.locator('#fi-name')).toHaveValue(item.name)
    await expect(page.locator('#fi-note')).toHaveValue('Old note')

    const newName = `${item.name} (edited)`
    await page.locator('#fi-name').fill(newName)
    await page.locator('#fi-name-jp').fill('')
    await page.locator('#fi-jan').fill('4901234567894')
    await page.locator('#fi-category').selectOption('game')
    await page.locator('#fi-note').fill('New note\nmore')
    await page.locator('#fi-save').click()

    await expect(page).toHaveURL(`/family?person=${PERSON}`)
    await expect(page.locator('#fam-done')).toHaveText('Saved ✓')
    await expect(famRow(page, newName).locator('.fam-note')).toHaveText('New note')
    const saved = await sanity.getDocument(item._id)
    expect(saved).toMatchObject({ name: newName, jan: '4901234567894', category: 'game', note: 'New note\nmore', person: PERSON })
    expect(saved.nameJp).toBeUndefined()
  })

  test('a new photo is sent as the background-uploaded asset id', async ({ page, sanity, trackDoc }) => {
    const item = await familyItem(sanity, trackDoc)
    await page.route('**/api/upload-image', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, assetId: 'image-abc123-100x100-png', url: 'https://cdn.sanity.io/x.png' }) })
    )
    const bodies: any[] = []
    await page.route('**/api/family-item-update', async (route) => {
      bodies.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.goto(`/edit-family-item?id=${item._id}`)
    await page.locator('#fi-photo-gallery').setInputFiles(PHOTO)
    await expect(page.locator('#fi-preview')).toBeVisible()
    await page.locator('#fi-save').click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).toMatchObject({ id: item._id, imageAssetId: 'image-abc123-100x100-png', removeImage: false })
  })

  test('delete asks for confirmation naming the item and person; cancel keeps it, OK deletes it', async ({ page, sanity, trackDoc }) => {
    const item = await familyItem(sanity, trackDoc)
    await page.goto(`/edit-family-item?id=${item._id}`)

    const messages: string[] = []
    page.once('dialog', (d) => { messages.push(d.message()); d.dismiss() })
    await page.locator('#fi-delete').click()
    await expect.poll(() => messages.length).toBe(1)
    expect(messages[0]).toBe(`Delete "${item.name}" from ${PERSON}'s items? This can't be undone.`)
    expect(await sanity.getDocument(item._id)).toBeTruthy()

    page.once('dialog', (d) => d.accept())
    await page.locator('#fi-delete').click()
    await expect(page).toHaveURL(`/family?person=${PERSON}`)
    await expect(page.locator('#fam-done')).toHaveText('Deleted')
    await expect(famRow(page, item.name)).toHaveCount(0)
    expect(await sanity.getDocument(item._id)).toBeFalsy()
  })

  test('the update endpoint refuses anything that isn\'t a family item', async ({ page, sanity, trackDoc }) => {
    const entry = await sanity.create({ _type: 'priceEntry', productName: testName(`Not Family ${Date.now()}`), category: 'game', sourceType: 'norway', price: 1, currency: 'NOK', status: 'considering', seenAt: new Date().toISOString() })
    trackDoc(entry._id)
    for (const data of [{ id: entry._id, name: 'Hacked' }, { id: entry._id, action: 'delete' }]) {
      const res = await page.request.post('/api/family-item-update', { data })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('Not a family item')
    }
    expect((await sanity.getDocument(entry._id)).productName).toBe(entry.productName)

    await page.goto(`/edit-family-item?id=${entry._id}`)
    await expect(page.locator('.hint')).toContainText('Item not found')
  })
})

test.describe('"← Back" and the result message for family items', () => {
  test('the edit page\'s "← Back" goes to that item\'s person on /family', async ({ page, sanity, trackDoc }) => {
    const item = await familyItem(sanity, trackDoc, { person: OTHER })
    await page.goto(`/edit-family-item?id=${item._id}`)
    const back = page.locator('.back-link', { hasText: '← Back' })
    await expect(back).toHaveAttribute('href', `/family?person=${OTHER}`)
    await back.click()
    await expect(page).toHaveURL(`/family?person=${OTHER}`)
    await expect(page.locator('#fam-person .chip.active')).toHaveText(OTHER)
    await expect(famRow(page, item.name, OTHER)).toBeVisible()
    await expect(page.locator('#fam-done')).toHaveCount(0) // nothing was saved
  })

  test('the "Saved ✓" message is shown once: it is dropped from the URL and gone after a reload', async ({ page }) => {
    await page.goto(`/family?person=${PERSON}&done=saved`)
    await expect(page.locator('#fam-done')).toHaveText('Saved ✓')
    await expect(page).toHaveURL(`/family?person=${PERSON}`)
    await page.reload()
    await expect(page.locator('#fam-done')).toHaveCount(0)
  })

  test('an unknown done= value shows no message', async ({ page }) => {
    await page.goto(`/family?person=${PERSON}&done=<b>hi</b>`)
    await expect(page.getByRole('heading', { name: 'Family items' })).toBeVisible()
    await expect(page.locator('#fam-done')).toHaveCount(0)
  })
})

test.describe('/add-item "← Back"', () => {
  const back = (page: import('@playwright/test').Page) => page.locator('#f-back')

  test('?owner=<family member>: back to that person on /family', async ({ page }) => {
    await page.goto(`/add-item?owner=${PERSON}`)
    await expect(back(page)).toHaveAttribute('href', `/family?person=${PERSON}`)
    await back(page).click()
    await expect(page).toHaveURL(`/family?person=${PERSON}`)
    await expect(page.locator('#fam-person .chip.active')).toHaveText(PERSON)
  })

  test('the "Who owns it?" selector updates it; Kim keeps today\'s link home', async ({ page }) => {
    await page.goto('/add-item')
    await expect(back(page)).toHaveAttribute('href', '/')
    await page.locator('#f-owner').selectOption(OTHER)
    await expect(back(page)).toHaveAttribute('href', `/family?person=${OTHER}`)
    await page.locator('#f-owner').selectOption('Kim')
    await expect(back(page)).toHaveAttribute('href', '/')
  })

  test('?owner=Kim keeps the link home', async ({ page }) => {
    await page.goto('/add-item?owner=Kim')
    await expect(back(page)).toHaveAttribute('href', '/')
  })
})
