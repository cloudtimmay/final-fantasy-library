import { test as base, expect } from '@playwright/test'
import { testClient, TEST_PREFIX, testName, deleteDocs } from './helpers/sanity-test-client'

type Fixtures = {
  sanity: typeof testClient
  // Call with any document _id a test creates (directly, or discovered after a UI flow
  // creates it) to have it deleted once the test ends — success or failure alike, since
  // this runs as fixture teardown, not a bare afterEach.
  trackDoc: (id: string | null | undefined) => void
}

export const test = base.extend<Fixtures>({
  sanity: async ({}, use) => {
    await use(testClient)
  },

  trackDoc: async ({}, use) => {
    const ids: string[] = []
    await use((id) => {
      if (id) ids.push(id)
    })
    await deleteDocs(ids)
  },
})

export { expect, TEST_PREFIX, testName }
