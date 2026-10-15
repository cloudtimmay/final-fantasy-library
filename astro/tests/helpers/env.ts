import fs from 'node:fs'
import path from 'node:path'

// Playwright compiles test/helper files as CommonJS, where __dirname is available
// natively — import.meta.url would need an ESM-only build, which isn't how Playwright
// runs these files by default.
const ENV_PATH = path.join(__dirname, '..', '..', '.env')

// Minimal .env loader (no dotenv dependency, matching the one-off-script pattern used
// elsewhere in this project) — only fills in vars not already set in the environment,
// so a real CI secret would still win over the file. Playwright's Node process doesn't
// get Astro/Vite's automatic .env loading, so the test runner needs its own.
export function loadEnv(): NodeJS.ProcessEnv {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  }
  return process.env
}

// The one thing standing between this test suite and accidentally writing to
// production: refuse to proceed unless the dataset is exactly "development". An
// allowlist, not a blocklist — a typo'd or unexpected dataset name must fail closed,
// not just the literal string "production".
export function assertDevelopmentDataset(): void {
  const env = loadEnv()
  if (env.SANITY_DATASET !== 'development') {
    throw new Error(
      `Refusing to run: SANITY_DATASET must be exactly "development" (got ${JSON.stringify(env.SANITY_DATASET)}). ` +
        'This guard exists so tests can never write to production data. Set SANITY_DATASET=development in astro/.env.'
    )
  }
}
