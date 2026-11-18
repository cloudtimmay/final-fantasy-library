// Saving a trip's plan with its undo history (lib/plan-history.ts): the version being replaced is
// kept as a snapshot document in the same transaction as the save, and snapshots beyond the last
// SNAPSHOT_KEEP for that plan are deleted. Used by /api/itinerary-save and /api/itinerary-history
// (a restore is a save too). Server only.
import { sanity, sanityWrite } from './sanity'
import { planSaveDoc, planDocIdFor, withFlightDays, type PlanTrip } from './trip-plans'
import { SNAPSHOT_TYPE, changedDays, snapshotIdFor, snapshotsToDelete } from './plan-history'

export async function savePlanWithSnapshot(trip: PlanTrip | null, data: string, now: Date = new Date(), note?: string): Promise<{ snapshotId: string | null; changed: string[] }> {
  const planDocId = planDocIdFor(trip)
  const existing: { data?: string } | null = await sanityWrite.fetch(`*[_id == $id][0]{ data }`, { id: planDocId })
  const prev = typeof existing?.data === 'string' ? existing.data : null
  const tx = sanityWrite.transaction()
  let snapshotId: string | null = null
  let changed: string[] = []
  // Nothing to keep when there was no plan yet or nothing changed.
  if (prev != null && prev !== data) {
    changed = changedDays(prev, data)
    snapshotId = snapshotIdFor(planDocId, now)
    tx.create({ _id: snapshotId, _type: SNAPSHOT_TYPE, planDoc: planDocId, savedAt: now.toISOString(), changedDays: changed, data: prev, ...(note ? { note } : {}) } as any)
  }
  tx.createOrReplace(planSaveDoc(trip, data, now) as any)
  // The oldest beyond the last SNAPSHOT_KEEP (counting the new one).
  if (snapshotId) {
    const ids: string[] = await sanityWrite.fetch(`*[_type == $t && planDoc == $p]._id`, { t: SNAPSHOT_TYPE, p: planDocId })
    for (const id of snapshotsToDelete([...ids, snapshotId])) tx.delete(id)
  }
  await tx.commit()
  return { snapshotId, changed }
}

// The trip a save or a restore is for: ?tripId as the pages send it, checked against Sanity (with
// the same days as the pages). null for no trip (the original plan); 'bad' / 'unknown' for errors.
export async function tripForPlan(tripId: unknown): Promise<PlanTrip | null | 'bad' | 'unknown'> {
  if (tripId == null || tripId === '') return null
  if (typeof tripId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) return 'bad'
  const trip: PlanTrip | null = await sanity.fetch(`*[_type == "tripSettings" && _id == $id][0]{ _id, firstTokyoDay, lastTokyoDay, arrivalDate, flightHomeDate }`, { id: tripId })
  return trip ? withFlightDays(trip) : 'unknown'
}
