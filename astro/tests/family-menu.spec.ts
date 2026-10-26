import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

test.describe('"Family items" entry in the add menu', () => {
  const cardTitles = (page: Page) => page.locator('.menu-card .menu-title')

  test('add-menu: the card comes right after "All prices" and opens /family', async ({ page }) => {
    await page.goto('/add-menu')
    const titles = await cardTitles(page).allTextContents()
    expect(titles[titles.indexOf('All prices') + 1]).toBe('Family items')
    await page.locator('.menu-card', { hasText: 'Family items' }).click()
    await expect(page).toHaveURL(/\/family/)
    await expect(page.getByRole('heading', { name: 'Family items' })).toBeVisible()
  })

  test('mobile: the bottom bar\'s "➕ Add" leads to the menu with Family items after All prices', async ({ page }) => {
    await page.goto('/prices')
    // Astro's dev toolbar (dev server only, never in production) sits over the bottom bar.
    await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' })
    await page.locator('.bottom-nav a', { hasText: 'Add' }).click()
    await expect(page).toHaveURL(/\/add-menu$/)
    const titles = await cardTitles(page).allTextContents()
    expect(titles[titles.indexOf('All prices') + 1]).toBe('Family items')
  })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })
    test('the top bar\'s "+ Add" leads to the menu with Family items after All prices', async ({ page }) => {
      await page.goto('/prices')
      await page.locator('nav a.nav-add').click()
      await expect(page).toHaveURL(/\/add-menu$/)
      const titles = await cardTitles(page).allTextContents()
      expect(titles[titles.indexOf('All prices') + 1]).toBe('Family items')
    })
  })
})
