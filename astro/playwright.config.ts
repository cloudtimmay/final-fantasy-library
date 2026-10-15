import { defineConfig, devices } from '@playwright/test'

// Default suite: mocked AI endpoints, runs against the local dev server on the
// "development" Sanity dataset (enforced by two independent guards — see
// tests/guard-dataset.mjs and tests/global-setup.ts). tests-ai-live/ is a separate,
// opt-in suite (playwright.ai-live.config.ts) for the handful of tests that hit the
// real Anthropic API.
export default defineConfig({
  testDir: './tests',
  // Fixtures share one real Sanity dataset rather than an isolated DB per test, so
  // running them serially avoids one test's in-flight create/delete interfering with
  // another's reads.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
  webServer: {
    command: 'npm run dev:test',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
