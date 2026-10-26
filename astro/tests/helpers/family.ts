import type { Page } from '@playwright/test'
import path from 'node:path'
import { testName } from '../fixtures'

// Shared by the /family specs (family.spec.ts, family-edit.spec.ts). /family lists real
// development-dataset documents for real family members, so every test finds its own rows by
// their unique "[test] …" names; other rows (real data, other tests' fixtures) are never
// assumed absent.
export const PERSON = 'Tone'
export const OTHER = 'Niklas'
export const PHOTO = path.join(__dirname, '..', '..', 'public', 'icons', 'album.png')

export const section = (page: Page, person = PERSON) => page.locator(`.person-items[data-person="${person}"]`)
export const famRow = (page: Page, name: string, person = PERSON) =>
  section(page, person).locator('.fam-row').filter({ has: page.locator('.fam-name', { hasText: name }) })

export async function familyItem(sanity: any, trackDoc: (id: string) => void, fields: Record<string, unknown> = {}) {
  const doc = await sanity.create({ _type: 'familyItem', person: PERSON, name: testName(`Family Item ${Date.now()} ${Math.random()}`), ...fields })
  trackDoc(doc._id)
  return doc
}
