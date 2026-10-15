import { test, expect } from './fixtures'

test.describe('spending page', () => {
  test('loads without the old "My FF collection" section', async ({ page }) => {
    await page.goto('/spending')
    await expect(page.locator('h1')).toHaveText('Spending')
    await expect(page.locator('h2', { hasText: 'My FF collection' })).toHaveCount(0)
    await expect(page.locator('#total-combined')).toHaveCount(0)
  })
})
