import { test, expect } from './fixtures'
import { verifyAccessJwt, resolveAccess, accessConfigFrom, certsUrl, resetAccessKeyCache, ACCESS_JWT_HEADER, ACCESS_EMAIL_HEADER, type AccessConfig } from '../src/lib/cf-access'
import { accessUserNames, accessUserName, LOCAL_DEV_USER } from '../src/lib/access-users'

// Cloudflare Access verification (lib/cf-access.ts, run by src/middleware.ts on every request).
// A key pair made here for the tests — never Cloudflare's keys — and its public half served by
// a fake fetch as the team's certs.
const TEAM = 'ff-test.cloudflareaccess.com'
const AUD = 'test-aud-0123456789abcdef'
const CONFIG: AccessConfig = { teamDomain: TEAM, aud: AUD }
const NOW = Date.UTC(2026, 11, 5, 10, 0, 0)
const KID = 'test-kid-1'

const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString('base64url')
const b64json = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)))
async function keyPair() {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
}
async function sign(privateKey: CryptoKey, claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' }) {
  const data = `${b64json(header)}.${b64json(claims)}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data))
  return `${data}.${b64url(sig)}`
}
const claimsFor = (extra: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`, aud: [AUD], email: 'tone@example.com', sub: 'user-1',
  iat: NOW / 1000 - 60, nbf: NOW / 1000 - 60, exp: NOW / 1000 + 3600, ...extra,
})

let pair: CryptoKeyPair
let certFetches = 0
let fetchCerts: typeof fetch
test.beforeAll(async () => {
  pair = await keyPair()
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  fetchCerts = (async (url: string) => {
    certFetches++
    if (url !== certsUrl(TEAM)) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as any
})
test.beforeEach(() => { resetAccessKeyCache(); certFetches = 0 })

const request = (headers: Record<string, string> = {}) => new Request('https://library.example/api/price-pick', { headers })
const production = (extra: Record<string, unknown> = {}) => ({ config: CONFIG, production: true, local: false, fetch: fetchCerts, now: NOW, names: { 'tone@example.com': 'Tone' }, ...extra })

test.describe('Cloudflare Access token (lib/cf-access.ts)', () => {
  test('a valid token passes and gives its email; the keys are fetched once and cached', async () => {
    const token = await sign(pair.privateKey, claimsFor())
    const v = await verifyAccessJwt(token, CONFIG, { fetch: fetchCerts, now: NOW })
    expect(v).toMatchObject({ ok: true, email: 'tone@example.com' })
    await verifyAccessJwt(token, CONFIG, { fetch: fetchCerts, now: NOW + 60_000 })
    expect(certFetches).toBe(1)
    // An "aud" as a plain string counts too.
    expect(await verifyAccessJwt(await sign(pair.privateKey, claimsFor({ aud: AUD })), CONFIG, { fetch: fetchCerts, now: NOW })).toMatchObject({ ok: true })
  })

  test('rejected: the wrong audience, expired, the wrong issuer, not valid yet, another key, an unknown key id, no RS256, garbage', async () => {
    const deps = { fetch: fetchCerts, now: NOW }
    const reason = async (token: string) => { const v = await verifyAccessJwt(token, CONFIG, deps); return v.ok ? 'ok' : v.reason }
    expect(await reason(await sign(pair.privateKey, claimsFor({ aud: ['another-app'] })))).toBe('Wrong audience')
    expect(await reason(await sign(pair.privateKey, claimsFor({ exp: NOW / 1000 - 3600 })))).toBe('Expired')
    expect(await reason(await sign(pair.privateKey, claimsFor({ iss: 'https://evil.cloudflareaccess.com' })))).toBe('Wrong issuer')
    expect(await reason(await sign(pair.privateKey, claimsFor({ nbf: NOW / 1000 + 3600 })))).toBe('Not valid yet')
    const other = await keyPair()
    expect(await reason(await sign(other.privateKey, claimsFor()))).toBe('Bad signature')
    expect(await reason(await sign(pair.privateKey, claimsFor(), { alg: 'RS256', kid: 'rotated-away' }))).toBe('Unknown signing key')
    expect(await reason(`${b64json({ alg: 'none', kid: KID })}.${b64json(claimsFor())}.`)).toBe('Unexpected algorithm')
    expect(await reason('not.a-token')).toBe('Malformed token')
    // A tampered email with the original signature.
    const [h, , s] = (await sign(pair.privateKey, claimsFor())).split('.')
    expect(await reason(`${h}.${b64json(claimsFor({ email: 'someone-else@example.com' }))}.${s}`)).toBe('Bad signature')
  })
})

test.describe('every request (resolveAccess, as src/middleware.ts uses it)', () => {
  test('production: no token, a wrong-audience token and an expired one are rejected (pages and /api/ alike)', async () => {
    expect(await resolveAccess(request(), production())).toEqual({ allow: false, reason: 'No Cloudflare Access token' })
    // The plain email header alone never gets in, nor names the user.
    expect(await resolveAccess(request({ [ACCESS_EMAIL_HEADER]: 'tone@example.com' }), production())).toMatchObject({ allow: false })
    const wrongAud = await sign(pair.privateKey, claimsFor({ aud: ['another-app'] }))
    expect(await resolveAccess(request({ [ACCESS_JWT_HEADER]: wrongAud }), production())).toEqual({ allow: false, reason: 'Wrong audience' })
    const expired = await sign(pair.privateKey, claimsFor({ exp: NOW / 1000 - 10 * 60 }))
    expect(await resolveAccess(request({ [ACCESS_JWT_HEADER]: expired }), production())).toEqual({ allow: false, reason: 'Expired' })
  })

  test('production: a valid token gets in, the user from the token (named by the list), not from the plain header', async () => {
    const token = await sign(pair.privateKey, claimsFor())
    const d = await resolveAccess(request({ [ACCESS_JWT_HEADER]: token, [ACCESS_EMAIL_HEADER]: 'someone-else@example.com' }), production())
    expect(d).toEqual({ allow: true, user: { email: 'tone@example.com', name: 'Tone' } })
  })

  test('production without the two settings: today\'s behaviour (the plain header), nothing blocked', async () => {
    expect(await resolveAccess(request({ [ACCESS_EMAIL_HEADER]: 'tone@example.com' }), production({ config: null })))
      .toEqual({ allow: true, user: { email: 'tone@example.com', name: 'Tone' } })
    expect(await resolveAccess(request(), production({ config: null }))).toEqual({ allow: true, user: null })
  })

  test('local dev (not Vercel production) is let through without Cloudflare; a Vercel preview has no user', async () => {
    const local = { config: CONFIG, production: false, local: true, fetch: fetchCerts, now: NOW }
    expect(await resolveAccess(request(), local)).toEqual({ allow: true, user: LOCAL_DEV_USER })
    expect(await resolveAccess(request({ [ACCESS_EMAIL_HEADER]: 'picks-home-test@example.com' }), local)).toMatchObject({ allow: true, user: { email: 'picks-home-test@example.com' } })
    const expired = await sign(pair.privateKey, claimsFor({ exp: NOW / 1000 - 3600 }))
    expect(await resolveAccess(request({ [ACCESS_JWT_HEADER]: expired }), local)).toEqual({ allow: true, user: LOCAL_DEV_USER })
    expect(await resolveAccess(request({ [ACCESS_EMAIL_HEADER]: 'tone@example.com' }), { ...local, local: false })).toEqual({ allow: true, user: null })
  })

  test('the settings: the team domain with or without https://, both needed', () => {
    expect(accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: 'https://ff-test.cloudflareaccess.com/', CF_ACCESS_AUD: ' abc ' })).toEqual({ teamDomain: TEAM, aud: 'abc' })
    expect(accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: TEAM })).toBeNull()
    expect(accessConfigFrom({ CF_ACCESS_AUD: 'abc' })).toBeNull()
  })

  test('the dev server: no token needed for a page or /api/', async ({ request: http }) => {
    expect((await http.get('/picks')).status()).toBe(200)
    expect((await http.post('/api/price-pick', { data: {} })).status()).toBe(400) // reached the endpoint (Missing id), not 403
  })
})

test.describe('logins → names (ACCESS_USER_NAMES)', () => {
  test('JSON {"email": "Name"}: case-insensitive; an unlisted email shows as itself; broken JSON or values left out', () => {
    const names = accessUserNames('{"Tone@Example.com": "Tone", "kim@example.com": "Kim", "bad": "X", "x@example.com": 5}')
    expect(names).toEqual({ 'tone@example.com': 'Tone', 'kim@example.com': 'Kim' })
    expect(accessUserName('TONE@example.com', names)).toBe('Tone')
    expect(accessUserName('someone@example.com', names)).toBe('someone@example.com')
    expect(accessUserNames(undefined)).toEqual({})
    expect(accessUserNames('')).toEqual({})
    expect(accessUserNames('not json')).toEqual({})
    expect(accessUserNames('["a"]')).toEqual({})
  })
})
