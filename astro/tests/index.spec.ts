import { test, expect } from './fixtures'

// Must match the hardcoded DEPART/RETURN in src/pages/index.astro exactly — both this
// file and that script construct dates via `new Date(y, m, d, h, mi, s)` (local time),
// so as long as neither Node (running this test) nor the browser context overrides its
// timezone, they resolve to the same instant and the offsets below are deterministic.
const DEPART = new Date(2026, 10, 30, 4, 30, 0) // 30 Nov 2026 04:30
const RETURN = new Date(2026, 11, 7, 23, 0, 0) // 7 Dec 2026 23:00

test.describe('homepage trip countdown', () => {
  test('shows days/hours/minutes counting down to departure', async ({ page }) => {
    const remainingMs = (3 * 24 * 60 + 2 * 60 + 15) * 60 * 1000 // 3 days, 2 hours, 15 minutes
    const fakeNow = new Date(DEPART.getTime() - remainingMs)

    // setFixedTime (not install) — Date.now()/new Date() stay frozen at this instant no
    // matter how much real time navigation takes; install()'s clock keeps ticking in
    // real time from its starting point, which drifted the result down by rounding
    // whenever that starting point landed exactly on a minute boundary like this one.
    await page.clock.setFixedTime(fakeNow)
    await page.goto('/')

    await expect(page.locator('#tc-title')).toHaveText('Nedtelling til Japan 🇯🇵')
    await expect(page.locator('#tc-cells')).toBeVisible()
    await expect(page.locator('#tc-done')).toBeHidden()
    await expect(page.locator('#c-days .tc-num')).toHaveText('3')
    await expect(page.locator('#c-hours .tc-num')).toHaveText('02')
    await expect(page.locator('#c-mins .tc-num')).toHaveText('15')
  })

  test('shows days/hours/minutes counting down to the return flight during the trip', async ({ page }) => {
    const remainingMs = (2 * 24 * 60 + 10 * 60 + 5) * 60 * 1000 // 2 days, 10 hours, 5 minutes
    const fakeNow = new Date(RETURN.getTime() - remainingMs)
    // Sanity check on the fixture itself: this instant must actually fall between
    // DEPART and RETURN for the assertions below to be testing the right phase.
    expect(fakeNow.getTime()).toBeGreaterThan(DEPART.getTime())
    expect(fakeNow.getTime()).toBeLessThan(RETURN.getTime())

    await page.clock.setFixedTime(fakeNow)
    await page.goto('/')

    await expect(page.locator('#tc-title')).toHaveText('Til hjemreise ✈️')
    await expect(page.locator('#tc-cells')).toBeVisible()
    await expect(page.locator('#tc-done')).toBeHidden()
    await expect(page.locator('#c-days .tc-num')).toHaveText('2')
    await expect(page.locator('#c-hours .tc-num')).toHaveText('10')
    await expect(page.locator('#c-mins .tc-num')).toHaveText('05')
  })
})
