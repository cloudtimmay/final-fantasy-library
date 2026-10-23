import { test as base, expect } from '@playwright/test'
import { testClient, TEST_PREFIX, testName, deleteDocs } from './helpers/sanity-test-client'

type Fixtures = {
  sanity: typeof testClient
  // Call with any document _id a test creates (directly, or discovered after a UI flow
  // creates it) to have it deleted once the test ends — success or failure alike, since
  // this runs as fixture teardown, not a bare afterEach.
  trackDoc: (id: string | null | undefined) => void
  // Every image asset /api/upload-image returned during the test. Choosing a photo on
  // /add-price, /add-item or /edit-product uploads it in the background straight away (src/
  // scripts/background-upload.js), even in a test that never saves — these are deleted
  // afterwards so the development dataset doesn't fill up with unreferenced assets.
  uploadedAssets: string[]
}

export const test = base.extend<Fixtures>({
  sanity: async ({}, use) => {
    await use(testClient)
  },

  uploadedAssets: [
    async ({ context }, use) => {
      const ids: string[] = []
      context.on('response', async (res) => {
        if (!res.url().includes('/api/upload-image') || !res.ok()) return
        try {
          const data = await res.json()
          if (typeof data?.assetId === 'string' && data.assetId.startsWith('image-')) ids.push(data.assetId)
        } catch {}
      })
      await use(ids)
      // One by one, and failures ignored: a mocked upload's made-up id doesn't exist, and an
      // asset still referenced by a document the test didn't track can't (and shouldn't) go.
      for (const id of new Set(ids)) {
        try { await testClient.delete(id) } catch {}
      }
    },
    { auto: true },
  ],

  // Depends on uploadedAssets so it's torn down first: tracked documents are deleted before
  // the assets they may reference.
  trackDoc: async ({ uploadedAssets }, use) => {
    void uploadedAssets
    const ids: string[] = []
    await use((id) => {
      if (id) ids.push(id)
    })
    await deleteDocs(ids)
  },
})

// A fresh 13-digit barcode for a fixture written to Sanity. Tests run in parallel against the
// one development dataset, and price entries group into products by JAN (and collection
// matching compares barcodes) — two tests saving the same hard-coded JAN at the same time
// would see each other's data. The 20–29 prefix is "restricted circulation" (in-store use),
// so it can never be a real product's code either.
let janCounter = 0
export function uniqueJan(): string {
  const n = (Date.now() % 1e8) * 1000 + Math.floor(Math.random() * 100) * 10 + (janCounter++ % 10)
  return '20' + String(n).padStart(11, '0').slice(-11)
}

export { expect, TEST_PREFIX, testName }
