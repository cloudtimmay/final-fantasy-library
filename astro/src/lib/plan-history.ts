// Undo and history for a trip's plan. Every save keeps the version it replaces as a snapshot — a
// separate `itinerarySnapshot` document (never inside the plan document), the last
// SNAPSHOT_KEEP per plan document — with the days that save changed. "↩ Undo last change"
// restores the newest snapshot; "🕘 History" lists them, and restores one day or everything. A
// restore is itself a save, so it gets a snapshot and can be undone too. Pure: the server's
// lib/plan-save.ts and /api/itinerary-history use these.

export const SNAPSHOT_KEEP = 30
export const SNAPSHOT_TYPE = 'itinerarySnapshot'

// "itinerarySnapshot-itineraryState-<ms>" — sortable by time, one per save.
export function snapshotIdFor(planDocId: string, now: Date): string {
  return `${SNAPSHOT_TYPE}-${planDocId}-${now.getTime()}`
}

type SavedPlan = { v?: number; days?: Record<string, unknown> }
function parsePlan(data: string | null | undefined): SavedPlan | null {
  if (!data) return null
  try {
    const p = JSON.parse(data)
    return p && typeof p === 'object' && !Array.isArray(p) && p.days && typeof p.days === 'object' ? p : null
  } catch { return null }
}

// The days a save changed (added, removed or different), in date order; ['all'] when either
// version can't be read day by day (an old format).
export function changedDays(before: string | null | undefined, after: string | null | undefined): string[] {
  const a = parsePlan(before), b = parsePlan(after)
  if (!a || !b) return ['all']
  const keys = [...new Set([...Object.keys(a.days!), ...Object.keys(b.days!)])].sort()
  return keys.filter((k) => JSON.stringify(a.days![k]) !== JSON.stringify(b.days![k]))
}

// The current plan with one day taken from a snapshot (removed when the snapshot hasn't it);
// every other day exactly as it is now. null when either can't be read day by day.
export function restoreDayInPlan(current: string, snapshot: string, day: string): string | null {
  const cur = parsePlan(current), snap = parsePlan(snapshot)
  if (!cur || !snap) return null
  const days = { ...cur.days! }
  if (day in snap.days!) days[day] = snap.days![day]
  else delete days[day]
  // The days in date order, as the page saves them.
  const ordered = Object.fromEntries(Object.keys(days).sort().map((k) => [k, days[k]]))
  return JSON.stringify({ ...cur, days: ordered })
}

// Which snapshots to delete: all but the newest `keep` (ids sort by time).
export function snapshotsToDelete(ids: string[], keep = SNAPSHOT_KEEP): string[] {
  return [...ids].sort().reverse().slice(keep)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "1 Dec, 3 Dec" — or "the whole plan" ('all') / "nothing" (no day).
export function changedDaysText(days: string[]): string {
  if (days.includes('all')) return 'the whole plan'
  if (!days.length) return 'nothing'
  return days.map((d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : d)).join(', ')
}
