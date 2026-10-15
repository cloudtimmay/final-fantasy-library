// Standalone, dependency-free guard run by `npm run dev:test` BEFORE `astro dev` even
// starts — the first and most bulletproof checkpoint, since the dev server literally
// cannot come up if this exits non-zero. Playwright's globalSetup (tests/global-setup.ts)
// re-checks the same thing independently, in case a dev server left running from an
// earlier session gets reused instead of started fresh (`reuseExistingServer`). Kept as
// plain JS (not imported from tests/helpers/env.ts) because this runs under plain
// `node`, not Playwright's TS-aware test runner.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')

let dataset = process.env.SANITY_DATASET
if (dataset === undefined && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^SANITY_DATASET=(.*)$/)
    if (m) dataset = m[1]
  }
}

if (dataset !== 'development') {
  console.error(
    `\nRefusing to start: SANITY_DATASET must be exactly "development" (got ${JSON.stringify(dataset)}).\n` +
      'This guard exists so the test dev server can never serve against production data.\n' +
      'Set SANITY_DATASET=development in astro/.env.\n'
  )
  process.exit(1)
}

console.log('Dataset guard OK: SANITY_DATASET=development')
