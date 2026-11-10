// Cloudflare Access on every request — pages and /api/ alike (lib/cf-access.ts resolveAccess):
// on Vercel production a valid Cf-Access-Jwt-Assertion token is required (403 otherwise), and the
// logged-in user (from that token) is put on Astro.locals.accessUser for the pages and endpoints.
// Without CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD set there, today's behaviour stays, with a warning.
// Local dev and tests (not Vercel production) aren't blocked.
import { defineMiddleware } from 'astro:middleware'
import { accessConfigFrom, resolveAccess } from './lib/cf-access'

let warnedUnconfigured = false

export const onRequest = defineMiddleware(async (context, next) => {
  const env = process.env
  const config = accessConfigFrom(env)
  const production = env.VERCEL_ENV === 'production'
  if (production && !config && !warnedUnconfigured) {
    warnedUnconfigured = true
    console.warn('Cloudflare Access is not verified: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (see CLAUDE.md).')
  }
  const decision = await resolveAccess(context.request, { config, production, local: !env.VERCEL })
  if (!decision.allow) {
    console.warn(`Cloudflare Access: rejected ${context.url.pathname} — ${decision.reason}`)
    return context.url.pathname.startsWith('/api/')
      ? new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      : new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  context.locals.accessUser = decision.user
  return next()
})
