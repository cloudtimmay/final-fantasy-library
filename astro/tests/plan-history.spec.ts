import { test, expect, testName } from './fixtures'
import { changedDays, restoreDayInPlan, snapshotsToDelete, snapshotIdFor, changedDaysText, SNAPSHOT_KEEP } from '../src/lib/plan-history'
import { planDocIdFor } from '../src/lib/trip-plans'

// Undo and history for a trip's plan (lib/plan-history.ts, lib/plan-save.ts,
// /api/itinerary-history). The API and page tests use a test trip in 2027, which has its own plan
// document — never the shared December plan.
const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 45, ...extra })
const plan = (d2: string[], d3: string[]) => JSON.stringify({ v: 2, days: {
  '2027-03-02': { startTime: '10:00', stops: d2.map((n) => stop(n)) },
  '2027-03-03': { startTime: '10:00', stops: d3.map((n) => stop(n)) },
} })

test.describe('plan history (lib/plan-history.ts)', () => {
  test('the days a save changed; one day restored, the rest as now; which snapshots go; the summary', () => {
    const a = plan(['A1', 'A2'], ['B1'])
    const b = plan(['A2', 'A1'], ['B1'])
    const c = plan(['A2', 'A1'], ['B1', 'B2'])
    expect(changedDays(a, b)).toEqual(['2027-03-02'])
    expect(changedDays(b, c)).toEqual(['2027-03-03'])
    expect(changedDays(a, a)).toEqual([])
    expect(changedDays('[1,2]', a)).toEqual(['all'])
    // 2 March from the first version, 3 March as now.
    expect(JSON.parse(restoreDayInPlan(c, a, '2027-03-02')!)).toEqual(JSON.parse(plan(['A1', 'A2'], ['B1', 'B2'])))
    expect(restoreDayInPlan('nope', a, '2027-03-02')).toBeNull()
    // Keep the newest 30; ids sort by time.
    const ids = Array.from({ length: 33 }, (_, i) => snapshotIdFor('itineraryState-t1', new Date(Date.UTC(2026, 10, 18, 8, 0, i))))
    expect(SNAPSHOT_KEEP).toBe(30)
    expect(snapshotsToDelete(ids)).toEqual(ids.slice(0, 3).reverse())
    expect(changedDaysText(['2026-12-01', '2026-12-03'])).toBe('1 Dec, 3 Dec')
    expect(changedDaysText(['all'])).toBe('the whole plan')
  })
})

async function testTrip(sanity: any, trackDoc: (id: string) => void) {
  const trip = await sanity.create({ _type: 'tripSettings', label: testName(`History Trip ${Date.now()}`), firstTokyoDay: '2027-03-02', lastTokyoDay: '2027-03-03' })
  trackDoc(trip._id)
  const planDoc = planDocIdFor(trip)
  expect(planDoc).toBe(`itineraryState-${trip._id}`) // its own document
  trackDoc(planDoc)
  // The snapshots made during the test, deleted afterwards too.
  const trackSnapshots = async () => { for (const id of await sanity.fetch('*[_type == "itinerarySnapshot" && planDoc == $p]._id', { p: planDoc })) trackDoc(id) }
  return { trip, planDoc, trackSnapshots }
}

test.describe('api: every save keeps the version before it; restore a day or everything', () => {
  test('save, save, save: two snapshots with what changed; a day restored; everything restored; each a new snapshot', async ({ request, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const { trip, planDoc, trackSnapshots } = await testTrip(sanity, trackDoc)
    const a = plan(['A1', 'A2'], ['B1']), b = plan(['A2', 'A1'], ['B1']), c = plan(['A2', 'A1'], ['B1', 'B2'])
    try {
      for (const data of [a, b, c]) expect((await request.post('/api/itinerary-save', { data: { data, tripId: trip._id } })).status()).toBe(200)
      let list = (await (await request.get(`/api/itinerary-history?tripId=${trip._id}`)).json()).snapshots
      expect(list.map((s: any) => s.changedDays)).toEqual([['2027-03-03'], ['2027-03-02']]) // newest first
      expect(list[0].summary).toBe('3 Mar')
      // The snapshot of the first save holds the first version; the plan document stays as it was.
      expect((await sanity.getDocument(list[1].id)).data).toBe(a)
      expect(Object.keys(await sanity.getDocument(planDoc)).sort()).toEqual(['_createdAt', '_id', '_rev', '_type', '_updatedAt', 'data', 'trip', 'updatedAt'])
      // Restore only 2 March from before the first change: 3 March stays as now.
      let res = await request.post('/api/itinerary-history', { data: { tripId: trip._id, snapshotId: list[1].id, day: '2027-03-02' } })
      expect(res.status()).toBe(200)
      expect(JSON.parse((await sanity.getDocument(planDoc)).data)).toEqual(JSON.parse(plan(['A1', 'A2'], ['B1', 'B2'])))
      list = (await (await request.get(`/api/itinerary-history?tripId=${trip._id}`)).json()).snapshots
      expect(list).toHaveLength(3) // the restore is a change too
      expect(list[0]).toMatchObject({ changedDays: ['2027-03-02'], note: expect.stringContaining('Restored 2027-03-02') })
      // Restore everything from the newest: back to before the restore.
      res = await request.post('/api/itinerary-history', { data: { tripId: trip._id, snapshotId: list[0].id } })
      expect(res.status()).toBe(200)
      expect((await sanity.getDocument(planDoc)).data).toBe(c)
      // Another trip's snapshot can't be restored here.
      expect((await request.post('/api/itinerary-history', { data: { tripId: trip._id, snapshotId: 'itinerarySnapshot-itineraryState-1' } })).status()).toBe(404)
    } finally {
      await trackSnapshots()
    }
  })
})

test.describe('/itinerary: ↩ Undo last change and 🕘 History', () => {
  test('Undo puts the plan back to before the last save (after confirming); History restores a day', async ({ page, request, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const { trip, planDoc, trackSnapshots } = await testTrip(sanity, trackDoc)
    const a = plan(['First Shop', 'Second Shop'], ['Third Shop'])
    const b = plan(['Second Shop', 'First Shop'], ['Third Shop', 'Fourth Shop'])
    try {
      for (const data of [a, b]) await request.post('/api/itinerary-save', { data: { data, tripId: trip._id } })
      await page.goto(`/itinerary?trip=${trip._id}`)
      await expect(page.locator('.itl-grid')).toBeVisible()
      const dialogs: string[] = []
      page.on('dialog', (d) => { dialogs.push(d.message()); d.accept() })
      // ↩ Undo: asks first, then the plan as before the last save.
      await page.locator('#itl-undo-btn').click()
      await expect.poll(async () => (await sanity.getDocument(planDoc)).data).toBe(a)
      expect(dialogs[0]).toMatch(/^Undo the last change \(2 Mar, 3 Mar, saved .+\)\? The whole plan goes back to before it\.$/)
      await expect(page.locator('.itl-grid')).toBeVisible() // reloaded
      await expect(page.locator('.itl-block .itl-name')).toHaveText(['First Shop', 'Second Shop'])
      // 🕘 History: the undo is listed too; restore only 3 March from it (as it was before the undo).
      await page.locator('#itl-history-btn').click()
      const rows = page.locator('#itl-history .itl-hist-row')
      await expect(rows).toHaveCount(2)
      await expect(rows.first().locator('.itl-hist-what')).toHaveText('Changed 2 Mar, 3 Mar (a restore)')
      await rows.first().locator('.itl-hist-day', { hasText: '3. mar' }).click()
      await expect.poll(async () => JSON.parse((await sanity.getDocument(planDoc)).data).days['2027-03-03'].stops.map((s: any) => s.name)).toEqual(['Third Shop', 'Fourth Shop'])
      expect(JSON.parse((await sanity.getDocument(planDoc)).data).days['2027-03-02'].stops.map((s: any) => s.name)).toEqual(['First Shop', 'Second Shop'])
      expect(dialogs[1]).toMatch(/^Restore 3\. mar \(ons\) as it was before the change saved .+\? Only that day changes; it can be undone\.$/)
    } finally {
      await trackSnapshots()
    }
  })
})
