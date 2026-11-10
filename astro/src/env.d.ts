/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    // The logged-in user from the verified Cloudflare Access token (src/middleware.ts); null
    // when there's none (e.g. a Vercel preview).
    accessUser?: import('./lib/access-users').AccessUser | null
  }
}
