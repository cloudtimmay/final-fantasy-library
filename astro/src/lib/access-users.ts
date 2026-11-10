// Who is logged in: the email Cloudflare Access puts on every request it lets through
// (Cf-Access-Authenticated-User-Email), shown as a name when it's a known login. The browser
// never says who it is — a name in a request body is ignored.
//
// The one place logins map to names (lowercase email → a name from PEOPLE_LIST in
// price-entry-fields.ts). An email not listed here is shown as itself.
export const ACCESS_USER_NAMES: Record<string, string> = {
  // 'someone@example.com': 'Kim',
}

export const ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email'

// Local development has no Cloudflare in front: picks made there are marked as such.
export const LOCAL_DEV_USER = { email: '', name: 'Local (no Cloudflare login)' }

export type AccessUser = { email: string; name: string }

// The name for an email: the listed one, else the email itself.
export function accessUserName(email: string, names: Record<string, string> = ACCESS_USER_NAMES): string {
  const key = email.trim().toLowerCase()
  return names[key] || email.trim()
}

// The logged-in user from the request's Cloudflare Access header; null without one (in
// production that means the request didn't come through Access).
export function accessUserFrom(request: Request, names: Record<string, string> = ACCESS_USER_NAMES): AccessUser | null {
  const email = (request.headers.get(ACCESS_EMAIL_HEADER) || '').trim()
  if (!email || email.length > 200 || !email.includes('@')) return null
  return { email, name: accessUserName(email, names) }
}
