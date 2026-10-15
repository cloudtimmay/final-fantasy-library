import { defineConfig, devices } from '@playwright/test'

// Opt-in only (`npm run test:ai-live`) — a handful of tests that hit the real
// Anthropic API for real, costing real usage. Never part of the default `npm test` run.
// Same dataset guards as the main config.
export default defineConfig({
  testDir: './tests-ai-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'retain-on-failure',
  },
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
