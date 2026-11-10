// Cloudflare Access on every request (src/middleware.ts): the Cf-Access-Jwt-Assertion token
// Cloudflare adds to each request it lets through, verified here — its RS256 signature against
// the team's public keys (https://<team domain>/cdn-cgi/access/certs, cached), the issuer (the
// team domain), the audience (the Access application's AUD tag) and the expiry. The user's
// email comes from the verified token only.
//
// Settings (environment variables, see CLAUDE.md):
//   CF_ACCESS_TEAM_DOMAIN  e.g. "myteam.cloudflareaccess.com"
//   CF_ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
// Enforced only on Vercel production (VERCEL_ENV=production). Without the two settings there,
// today's behaviour stays (with a warning in the log). Local dev and tests run without
// Cloudflare. Uses WebCrypto (no library); pure apart from the injected fetch and clock.
import { accessUserName, LOCAL_DEV_USER, type AccessUser } from './access-users'

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'
// The plain email header Cloudflare also sends — trusted only where nothing is verified (local
// dev, and production before the settings are added): never instead of a verified token.
export const ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email'

export type AccessConfig = { teamDomain: string; aud: string }
type Env = Record<string, string | undefined>

// The settings, or null when either is missing. "https://myteam.cloudflareaccess.com/" and
// "myteam.cloudflareaccess.com" are the same team domain.
export function accessConfigFrom(env: Env): AccessConfig | null {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const aud = (env.CF_ACCESS_AUD || '').trim()
  return teamDomain && aud ? { teamDomain, aud } : null
}
export const certsUrl = (teamDomain: string) => `https://${teamDomain}/cdn-cgi/access/certs`

// --- The team's public keys, cached ----------------------------------------------------------
type Jwk = JsonWebKey & { kid?: string }
export const KEYS_CACHE_MS = 60 * 60 * 1000 // Cloudflare rotates its keys every 6 weeks
const keyCache = new Map<string, { at: number; keys: Jwk[] }>()
export function resetAccessKeyCache(): void { keyCache.clear() }

async function teamKeys(teamDomain: string, fetchFn: typeof fetch, now: number, refresh: boolean): Promise<Jwk[]> {
  const url = certsUrl(teamDomain)
  const hit = keyCache.get(url)
  if (hit && !refresh && now - hit.at < KEYS_CACHE_MS) return hit.keys
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Access keys: HTTP ${res.status}`)
  const data = await res.json()
  const keys: Jwk[] = Array.isArray(data?.keys) ? data.keys : []
  keyCache.set(url, { at: now, keys })
  return keys
}

// --- Verifying a token ------------------------------------------------------------------------
const b64urlBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const b64urlJson = (s: string): any => JSON.parse(new TextDecoder().decode(b64urlBytes(s)))
// A little room for clocks that disagree by a few seconds.
const CLOCK_SKEW_S = 30

export type VerifyResult = { ok: true; email: string; claims: Record<string, unknown> } | { ok: false; reason: string }

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  deps: { fetch?: typeof fetch; now?: number } = {},
): Promise<VerifyResult> {
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now()
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'Malformed token' }
  let header: any, claims: any
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]) } catch { return { ok: false, reason: 'Malformed token' } }
  if (header?.alg !== 'RS256') return { ok: false, reason: 'Unexpected algorithm' }

  // The key it was signed with (by its id); an unknown id: the keys once more (rotated).
  let keys: Jwk[]
  try { keys = await teamKeys(config.teamDomain, fetchFn, now, false) } catch { return { ok: false, reason: 'Could not fetch the Access keys' } }
  let jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) {
    try { keys = await teamKeys(config.teamDomain, fetchFn, now, true) } catch { return { ok: false, reason: 'Could not fetch the Access keys' } }
    jwk = keys.find((k) => k.kid === header.kid)
  }
  if (!jwk || jwk.kty !== 'RSA') return { ok: false, reason: 'Unknown signing key' }

  let valid = false
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  } catch { valid = false }
  if (!valid) return { ok: false, reason: 'Bad signature' }

  if (claims?.iss !== `https://${config.teamDomain}`) return { ok: false, reason: 'Wrong issuer' }
  const auds = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud]
  if (!auds.includes(config.aud)) return { ok: false, reason: 'Wrong audience' }
  const nowS = now / 1000
  if (typeof claims?.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: 'Expired' }
  if (typeof claims?.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) return { ok: false, reason: 'Not valid yet' }
  return { ok: true, email: typeof claims.email === 'string' ? claims.email : '', claims }
}

// --- Who may in, and who they are ---------------------------------------------------------------
export type AccessDecision = { allow: true; user: AccessUser | null } | { allow: false; reason: string }

const plainHeaderUser = (request: Request, names?: Record<string, string>): AccessUser | null => {
  const email = (request.headers.get(ACCESS_EMAIL_HEADER) || '').trim()
  return email && email.length <= 200 && email.includes('@') ? { email, name: accessUserName(email, names) } : null
}

// - Production with the settings: a valid token, else rejected (403) — the user from the token.
// - Production without them: today's behaviour (the plain email header), the caller warns.
// - Anywhere else: let through. A valid token still gives its user; on a local machine (not
//   Vercel) the plain header stands in for a login (the tests' simulated login), else the
//   local dev user; a Vercel preview has no user (nothing can be picked there).
export async function resolveAccess(
  request: Request,
  ctx: { config: AccessConfig | null; production: boolean; local: boolean; fetch?: typeof fetch; now?: number; names?: Record<string, string> },
): Promise<AccessDecision> {
  const token = (request.headers.get(ACCESS_JWT_HEADER) || '').trim()
  if (ctx.config) {
    if (token) {
      const v = await verifyAccessJwt(token, ctx.config, { fetch: ctx.fetch, now: ctx.now })
      if (v.ok) return { allow: true, user: v.email ? { email: v.email, name: accessUserName(v.email, ctx.names) } : null }
      if (ctx.production) return { allow: false, reason: v.reason }
    } else if (ctx.production) {
      return { allow: false, reason: 'No Cloudflare Access token' }
    }
  }
  if (ctx.production) return { allow: true, user: ctx.config ? null : plainHeaderUser(request, ctx.names) }
  return { allow: true, user: ctx.local ? plainHeaderUser(request, ctx.names) || LOCAL_DEV_USER : null }
}
