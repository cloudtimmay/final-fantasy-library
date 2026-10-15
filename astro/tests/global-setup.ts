import { assertDevelopmentDataset } from './helpers/env'
import { sweepTestFixtures } from './helpers/sanity-test-client'

// Runs once before any test (and, per Playwright, before the webServer is reused if
// one is already running) — the second of two dataset guards. tests/guard-dataset.mjs
// covers a freshly-started dev server; this one covers a dev server left running from
// an earlier session that gets reused instead of restarted, which would otherwise skip
// that first check entirely.
export default async function globalSetup(): Promise<void> {
  assertDevelopmentDataset()
  const deleted = await sweepTestFixtures()
  if (deleted > 0) {
    console.log(`[global-setup] Swept ${deleted} leftover "[test] "-prefixed document(s) from a previous run.`)
  }
}
