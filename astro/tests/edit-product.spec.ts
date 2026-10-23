import { test, expect, testName, uniqueJan } from './fixtures'

test.describe('edit-product', () => {
  test('prefills product-level fields', async ({ page, trackDoc, sanity }) => {
    const productName = testName(`Edit Product Prefill ${Date.now()}`)
    const jan = uniqueJan()
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      productNameJp: 'プリフィル テスト',
      jan,
      category: 'album',
      sourceType: 'japanStore',
      price: 3000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)
    const key = jan

    await page.goto(`/edit-product?product=${encodeURIComponent(key)}`)

    await expect(page.locator('#p-name')).toHaveValue(productName)
    await expect(page.locator('#p-name-jp')).toHaveValue('プリフィル テスト')
    await expect(page.locator('#p-jan')).toHaveValue(jan)
    await expect(page.locator('#p-category')).toHaveValue('album')
  })

  test('editing name and category updates every price entry sharing the product key', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const productName = testName(`Edit Product Save ${Date.now()}`)
    const jan = uniqueJan()
    const created = await sanity.create({
      _type: 'priceEntry',
      productName,
      jan,
      category: 'game',
      sourceType: 'japanStore',
      price: 4000,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(created._id)

    const newName = testName(`Edit Product Save Renamed ${Date.now()}`)
    await page.goto(`/edit-product?product=${encodeURIComponent(jan)}`)
    await page.locator('#p-name').fill(newName)
    await page.locator('#p-category').selectOption('book')
    await page.locator('#p-save').click()

    await expect(page).toHaveURL(/\/prices/)

    const after = await sanity.fetch<{ productName: string; category: string }>(
      '*[_id == $id][0]{ productName, category }',
      { id: created._id }
    )
    expect(after.productName).toBe(newName)
    expect(after.category).toBe('book')
  })

  test('shows a note when another product shares the same name', async ({ page, trackDoc, sanity }) => {
    const sharedName = testName(`Shared Name ${Date.now()}`)
    const firstJan = uniqueJan()
    const first = await sanity.create({
      _type: 'priceEntry',
      productName: sharedName,
      jan: firstJan,
      category: 'figure',
      sourceType: 'japanStore',
      price: 2500,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(first._id)
    const second = await sanity.create({
      _type: 'priceEntry',
      productName: sharedName,
      jan: uniqueJan(),
      category: 'figure',
      sourceType: 'japanStore',
      price: 2600,
      currency: 'JPY',
      condition: 'new',
      status: 'considering',
      seenAt: new Date().toISOString(),
    })
    trackDoc(second._id)

    await page.goto(`/edit-product?product=${encodeURIComponent(firstJan)}`)

    await expect(page.locator('#p-name-note')).toBeVisible()
    await expect(page.locator('#p-name-note')).toContainText('Another product with this name exists')
  })
})
