import { test, expect } from './fixtures'

test.describe('add menu', () => {
  test('shows all menu cards and links to the right pages', async ({ page }) => {
    await page.goto('/add-menu')

    const links: [string, string][] = [
      ['Add price', '/add-price'],
      ['All prices', '/prices'],
      ['Family purchase', '/add'],
      ['Shop', '/add-store'],
      ['Airport checklist', '/checklist'],
      ['Scan / search', '/scan'],
      ['Add item', '/add-item'],
      ['Missing info', '/missing-info'],
    ]

    for (const [label, href] of links) {
      // Match the exact card title, not any text in the card (e.g. "Shop" is also a
      // substring of "Log a price you've seen — shop, …" and "Trip budget shopping…").
      const card = page.locator('a.menu-card').filter({ has: page.locator('.menu-title', { hasText: new RegExp(`^${label}$`) }) })
      await expect(card).toHaveAttribute('href', href)
    }
  })

  test('"Add item" card is listed after "Airport checklist" and "Scan / search"', async ({ page }) => {
    await page.goto('/add-menu')
    const titles = await page.locator('a.menu-card .menu-title').allTextContents()

    const addItemIndex = titles.indexOf('Add item')
    const checklistIndex = titles.indexOf('Airport checklist')
    const scanIndex = titles.indexOf('Scan / search')

    expect(addItemIndex).toBeGreaterThan(checklistIndex)
    expect(addItemIndex).toBeGreaterThan(scanIndex)
  })

  test('"Add price" card navigates to /add-price', async ({ page }) => {
    await page.goto('/add-menu')
    await page.locator('a.menu-card', { hasText: 'Add price' }).click()
    await expect(page).toHaveURL(/\/add-price/)
    await expect(page.getByRole('heading', { level: 1, name: 'Add price', exact: true })).toBeVisible()
  })
})
