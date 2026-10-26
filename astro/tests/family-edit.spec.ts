import { test, expect, testName } from './fixtures'
import { PERSON, PHOTO, famRow, familyItem } from './helpers/family'

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
