import { test, expect, testName } from './fixtures'
import { findIdByField } from './helpers/sanity-test-client'

test.describe('add family purchase: paid with passport', () => {
  test('is hidden for Planned, shown and defaulted to Kim for Bought, and saved on the document', async ({
    page,
    trackDoc,
    sanity,
  }) => {
    const tripLabel = testName(`Add FP Trip ${Date.now()}`)
    const trip = await sanity.create({
      _type: 'tripSettings',
      label: tripLabel,
      childBudgets: [{ _key: 'k1', person: 'Tone', budgetNok: 5000 }],
    })
    trackDoc(trip._id)

    await page.goto('/add')
    await page.locator('#f-trip').selectOption(trip._id)
    await page.locator('#f-person').selectOption('Tone')

    await expect(page.locator('#f-passport-field')).toBeHidden()

    const name = testName(`Passport Item ${Date.now()}`)
    await page.locator('#f-name').fill(name)
    await page.locator('#f-yen').fill('6000')
    await page.locator('#f-status').selectOption('bought')

    await expect(page.locator('#f-passport-field')).toBeVisible()
    await expect(page.locator('#f-passport')).toHaveValue('Kim')

    await page.locator('#f-save').click()
    await expect(page.locator('#f-msg')).toContainText('Saved')

    const id = await findIdByField('familyPurchase', 'name', name)
    expect(id).toBeTruthy()
    trackDoc(id)

    const fp = await sanity.fetch<{ person: string; passportHolder: string }>(
      '*[_id == $id][0]{ person, passportHolder }',
      { id }
    )
    expect(fp.person).toBe('Tone')
    expect(fp.passportHolder).toBe('Kim')

    // Status resets to Planned after a save, which hides the field again.
    await expect(page.locator('#f-passport-field')).toBeHidden()
  })
})
