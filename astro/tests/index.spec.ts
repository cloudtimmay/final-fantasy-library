import { test, expect } from './fixtures'

// Must match DEPART/RETURN in src/pages/index.astro exactly: Norwegian time with its offset,
// so the instants are the same whatever timezone Node or the browser runs in.
const DEPART = new Date('2026-11-30T04:30:00+01:00') // 30 Nov 2026 04:30, Oslo
const RETURN = new Date('2026-12-07T09:50:00+01:00') // 7 Dec 2026 09:50, landing at Oslo Airport

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

test.describe('homepage trip countdown on a phone set to Japan time', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test('counts down to landing in Oslo on 7 December 09:50 Norwegian time, not Japan time', async ({ page }) => {
    // 6 Dec 2026 23:00 in Tokyo = 6 Dec 15:00 in Oslo: 18 h 50 min before landing.
    await page.clock.setFixedTime(new Date('2026-12-06T23:00:00+09:00'))
    await page.goto('/')
    await expect(page.locator('#tc-title')).toHaveText('Til hjemreise ✈️')
    await expect(page.locator('#c-days .tc-num')).toHaveText('0')
    await expect(page.locator('#c-hours .tc-num')).toHaveText('18')
    await expect(page.locator('#c-mins .tc-num')).toHaveText('50')
  })

  test('is over after landing', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-07T09:51:00+01:00'))
    await page.goto('/')
    await expect(page.locator('#tc-title')).toHaveText('Turen er over 💤')
  })
})
