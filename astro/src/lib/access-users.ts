// Who is logged in: the email from the verified Cloudflare Access token (lib/cf-access.ts, put
// on Astro.locals.accessUser by src/middleware.ts), shown as a name when it's a known login.
// The browser never says who it is — a name in a request body is ignored.
//
// Logins → names: the ACCESS_USER_NAMES environment variable, JSON {"email": "Name"} (names
// from PEOPLE_LIST in price-entry-fields.ts), empty by default — see CLAUDE.md. An email not
// listed there is shown as itself.

import { OWNER } from './price-entry-fields'

export type AccessUser = { email: string; name: string }

// Local development has no Cloudflare in front: picks made there are marked as such.
export const LOCAL_DEV_USER: AccessUser = { email: '', name: 'Local (no Cloudflare login)' }

const env = (key: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[key] : undefined)

// The list from the variable (`raw`): lowercase emails → names; anything that isn't a JSON
// object of strings is left out (a broken variable gives an empty list and a warning).
let warned = false
export function accessUserNames(raw: string | undefined = env('ACCESS_USER_NAMES')): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  let data: unknown
  try { data = JSON.parse(raw) } catch {
    if (!warned) { warned = true; console.warn('ACCESS_USER_NAMES is not valid JSON ({"email":"Name"}) — emails are shown as they are.') }
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: Record<string, string> = {}
  for (const [email, name] of Object.entries(data as Record<string, unknown>)) {
    if (typeof name === 'string' && name.trim() && email.includes('@')) out[email.trim().toLowerCase()] = name.trim()
  }
  return out
}

// The owner (OWNER): a login whose name is OWNER (their emails in ACCESS_USER_NAMES), or local
// development (no Cloudflare: the one using it is the owner). E.g. "🎁 Hide from Picks".
export function isOwnerUser(user: AccessUser | null | undefined): boolean {
  if (!user) return false
  if (user.email === LOCAL_DEV_USER.email && user.name === LOCAL_DEV_USER.name) return true
  return user.name === OWNER
}

// The name for an email: the listed one, else the email itself.
export function accessUserName(email: string, names: Record<string, string> = accessUserNames()): string {
  return names[email.trim().toLowerCase()] || email.trim()
}
