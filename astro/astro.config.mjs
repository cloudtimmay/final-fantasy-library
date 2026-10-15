import { defineConfig } from 'astro/config'
import vercel from '@astrojs/vercel'

export default defineConfig({
  output: 'server',
  adapter: vercel({
    webAnalytics: { enabled: false },
    // @astrojs/vercel has no per-route duration setting — this adapter option is global,
    // applied to every SSR/API route the adapter deploys. Raised for /api/find-prices.ts
    // (web search with up to 5 tool round-trips, ~55s internal timeout) so Vercel doesn't
    // kill it at the platform default (10s on Hobby, 15s on Pro unless configured). Every
    // other route still returns as fast as it always did — this only raises the ceiling.
    // Needs a Vercel plan that allows 60s function duration (Hobby/Pro both do via Fluid
    // Compute as of late 2025 — verify on your plan's current dashboard limits).
    maxDuration: 60,
  }),
})