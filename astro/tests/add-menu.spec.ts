import { test, expect } from './fixtures'

test.describe('add menu', () => {
  test('shows all menu cards and links to the right pages', async ({ page }) => {
    await page.goto('/add-menu')

    const links: [string, string][] = [
      ['Add price', '/add-price'],
      ['All prices', '/prices'],
      ['Add item', '/add-item'],
      ['Family purchase', '/add'],
      ['Shop', '/add-store'],
      ['Scan / search', '/scan'],
    ]

    for (const [label, href] of links) {
      // Match the exact card title, not any text in the card (e.g. "Shop" is also a
      // substring of "Log a price you've seen — shop, …" and "Trip budget shopping…").
      const card = page.locator('a.menu-card').filter({ has: page.locator('.menu-title', { hasText: new RegExp(`^${label}$`) }) })
      await expect(card).toHaveAttribute('href', href)
    }
  })

  test('"Add price" card navigates to /add-price', async ({ page }) => {
    await page.goto('/add-menu')
    await page.locator('a.menu-card', { hasText: 'Add price' }).click()
    await expect(page).toHaveURL(/\/add-price/)
    await expect(page.locator('h1')).toHaveText('Add price')
  })
})
