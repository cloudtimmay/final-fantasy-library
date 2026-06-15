import { defineConfig } from 'astro/config'
import vercel from '@astrojs/vercel/serverless'

export default defineConfig({
  output: 'server',      // SSR — fresh data on each request, no rebuild needed
  adapter: vercel(),
})
