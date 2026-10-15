import { createClient } from '@sanity/client'
import { loadEnv, assertDevelopmentDataset } from './env'

const env = loadEnv()

// Fails loudly at import time (before any fixture ever runs) if the dataset isn't
// "development" — redundant with global-setup.ts's check, deliberately, since this
// module is what actually holds the write credentials used to create/delete documents.
assertDevelopmentDataset()

export const testClient = createClient({
  projectId: env.SANITY_PROJECT_ID,
  dataset: env.SANITY_DATASET,
  apiVersion: '2024-01-01',
  useCdn: false,
  token: env.SANITY_WRITE_TOKEN,
})

// Every document this suite creates gets a name/title starting with this — lets a
// human glance at the "development" dataset in Studio and immediately tell test
// fixtures apart from the real content copied in from production, and lets cleanup
// find anything a crashed run left behind.
export const TEST_PREFIX = '[test] '

export function testName(label: string): string {
  return `${TEST_PREFIX}${label}`
}

const FIXTURE_TYPES_BY_NAME_FIELD: { type: string; field: string }[] = [
  { type: 'priceEntry', field: 'productName' },
  { type: 'album', field: 'title' },
  { type: 'game', field: 'title' },
  { type: 'book', field: 'title' },
  { type: 'figure', field: 'title' },
  { type: 'familyPurchase', field: 'name' },
  { type: 'tripSettings', field: 'label' },
  { type: 'shopNote', field: 'shopName' },
]

// Safety-net sweep for anything a previous crashed/interrupted run left behind — run
// once before the whole suite (global setup). Per-test cleanup (the `trackDoc` fixture)
// is what normally deletes fixtures; this just catches what that missed.
export async function sweepTestFixtures(): Promise<number> {
  const clauses = FIXTURE_TYPES_BY_NAME_FIELD.map(
    ({ type, field }) => `(_type == "${type}" && defined(${field}) && string::startsWith(${field}, $prefix))`
  ).join(' || ')
  const ids: string[] = await testClient.fetch(`*[${clauses}]._id`, { prefix: TEST_PREFIX })
  if (ids.length === 0) return 0
  const tx = testClient.transaction()
  ids.forEach((id) => tx.delete(id))
  await tx.commit()
  return ids.length
}

export async function deleteDocs(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (uniqueIds.length === 0) return
  const tx = testClient.transaction()
  uniqueIds.forEach((id) => tx.delete(id))
  await tx.commit()
}

export async function findIdByField(type: string, field: string, value: string): Promise<string | null> {
  const id: string | null = await testClient.fetch(`*[_type == $type && ${field} == $value][0]._id`, { type, value })
  return id || null
}
