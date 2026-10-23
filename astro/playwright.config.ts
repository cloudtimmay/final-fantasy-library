import { defineConfig, devices } from '@playwright/test'

// Default suite: mocked AI endpoints, runs against the local dev server on the
// "development" Sanity dataset (enforced by two independent guards — see
// tests/guard-dataset.mjs and tests/global-setup.ts). tests-ai-live/ is a separate,
// opt-in suite (playwright.ai-live.config.ts) for the handful of tests that hit the
// real Anthropic API.
export default defineConfig({
  testDir: './tests',
  // Parallel, tests within a file included. The tests share one real Sanity dataset, which
  // is safe only because every test touches nothing but its own fixtures: "[test] "-prefixed
  // names, unique barcodes (uniqueJan() in tests/fixtures.ts), its own trip selected
  // explicitly (?trip=<id>), and mocks for anything that writes shared data (the itinerary's
  // autosave) — keep it that way when adding tests. 6 workers on this 8-thread / 8 GB
  // machine (each is a WebKit instance, all hitting the one Astro dev server); measured
  // October 2026, full suite: 1 worker 15.0 min, 4 workers 4.5 min, 6 workers 3.8 min.
  // Override with PW_WORKERS (PW_WORKERS=1 for a serial run).
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS) || 6,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Blocked by default: with an active service worker, Playwright's page.route() can
    // bypass the mocked AI/API routes most specs rely on (the request goes through the
    // service worker's own fetch() instead of the page's). The handful of specs that
    // actually need a real service worker (sw.spec.ts, the offline case in
    // saved-copy-banner.spec.ts) opt back in with test.use({ serviceWorkers: 'allow' }).
    serviceWorkers: 'block',
  },
  // iOS Safari (WebKit) specifically, not Chromium — this app's real bug history
  // (iOS ignoring <option>.hidden, [hidden] CSS cascade quirks) is WebKit/mobile-only,
  // so that's the engine that actually catches regressions here.
  projects: [
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  // An already running dev server (npm run dev:test) is reused as-is; otherwise one is
  // started, and a cold Astro start can take well over a minute on this machine.
  webServer: {
    command: 'npm run dev:test',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
