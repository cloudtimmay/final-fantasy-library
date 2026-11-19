import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { swapDays, moveStopsToDay, deleteStops } from '../src/lib/itinerary-plan'

// Moving days and stops on the timeline (itinerary-plan.ts swapDays / moveStopsToDay /
// deleteStops): "⇄ Swap with day…" and "☑ Select stops". Saves are mocked (the shared plan is
// never written); the toast's "↩ Undo" goes through the plan's history (mocked here).
const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 45, ...extra })
const TRAIN = { walkToStationMin: 5, legs: [{ line: 'Yamanote Line', train: '', fromStation: 'Akihabara', departure: '11:00', platform: '', toStation: 'Shinjuku', arrival: '11:15' }] }

test.describe('moving days and stops (lib/itinerary-plan.ts)', () => {
  test('swap: stops (with their trains), start, bases and the train back change places; the airport train stays', () => {
    const a: any = { day: '2026-12-05', startTime: '09:00', startBase: 'hotelA', stops: [stop('A1'), stop('A2', { train: TRAIN })], returnTrain: TRAIN, airportTrain: TRAIN }
    const b: any = { day: '2026-12-06', startTime: '11:00', stops: [stop('B1')] }
    swapDays(a, b)
    expect(a).toMatchObject({ startTime: '11:00', stops: [{ name: 'B1' }] })
    expect(a.startBase).toBeUndefined()
    expect(a.returnTrain).toBeUndefined()
    expect(a.airportTrain).toEqual(TRAIN) // the flight day's
    expect(b).toMatchObject({ startTime: '09:00', startBase: 'hotelA', returnTrain: TRAIN, stops: [{ name: 'A1' }, { name: 'A2', train: TRAIN }] })
    expect(b.airportTrain).toBeUndefined()
  })

  test('move the selected stops, in their order, to the end of another day; delete the selected', () => {
    const from = { stops: [stop('A'), stop('B'), stop('C'), stop('D')] }
    const to = { stops: [stop('X')] }
    expect(moveStopsToDay(from, [2, 0], to)).toBe(2)
    expect(from.stops.map((s) => s.name)).toEqual(['B', 'D'])
    expect(to.stops.map((s) => s.name)).toEqual(['X', 'A', 'C'])
    expect(deleteStops(to, [0, 2])).toBe(2)
    expect(to.stops.map((s) => s.name)).toEqual(['A'])
  })
})

test.describe('/itinerary: ⇄ Swap with day and ☑ Select stops', () => {
  async function open(page: Page, sanity: any, trackDoc: (id: string) => void) {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Moving Trip ${Date.now()}`), firstTokyoDay: '2027-03-02', lastTokyoDay: '2027-03-03' })
    trackDoc(trip._id)
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => { saves.push(JSON.parse(route.request().postDataJSON().data)); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
    // The plan's history, answered here: one snapshot to undo to.
    const restores: any[] = []
    await page.route('**/api/itinerary-history*', async (route) => {
      if (route.request().method() === 'POST') { restores.push(route.request().postDataJSON()); await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stop here"}' }); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, snapshots: [{ id: 'itinerarySnapshot-x-1', savedAt: new Date().toISOString(), changedDays: ['2027-03-02', '2027-03-03'], summary: '2 Mar, 3 Mar' }] }) })
    })
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[0].startTime = '09:00'
      itl.state[0].stops = ['First', 'Second', 'Third', 'Fourth'].map((n) => ({ name: n, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 }))
      itl.state[1].startTime = '11:00'
      itl.state[1].stops = [{ name: 'Other Day Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 }]
      itl.render()
    })
    const dialogs: string[] = []
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept() })
    return { saves, restores, dialogs }
  }
  const names = (page: Page, i: number) => page.evaluate((i) => (window as any).__itl.state[i].stops.map((s: any) => s.name), i)

  test('swap two days, after confirming; saved; the toast\'s ↩ Undo goes to the plan\'s history', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const { saves, restores, dialogs } = await open(page, sanity, trackDoc)
    await page.locator('#itl-swap-btn').click()
    await expect(page.locator('#itl-swap-day option')).toHaveText(['3. mar (ons) (1 stop)'])
    await page.locator('#itl-swap-go').click()
    expect(dialogs[0]).toBe('Swap everything on 2. mar (tir) and 3. mar (ons)? The stops (with their trains), the start times and the bases change places.')
    expect(await names(page, 0)).toEqual(['Other Day Stop'])
    expect(await names(page, 1)).toEqual(['First', 'Second', 'Third', 'Fourth'])
    expect(await page.evaluate(() => (window as any).__itl.state.map((d: any) => d.startTime))).toEqual(['11:00', '09:00'])
    await expect(page.locator('#itl-act-toast')).toContainText('Swapped 2. mar (tir) and 3. mar (ons).')
    await expect.poll(() => saves.length > 0 && saves[saves.length - 1].days['2027-03-03'].stops.length).toBe(4)
    // ↩ Undo: the plan's newest snapshot, after confirming.
    await page.locator('#itl-act-undo').click()
    await expect.poll(() => restores.length).toBe(1)
    expect(restores[0]).toMatchObject({ snapshotId: 'itinerarySnapshot-x-1' })
    expect(dialogs).toContainEqual(expect.stringMatching(/^Undo the last change \(2 Mar, 3 Mar, saved /))
  })

  test('select stops: move two to another day (appended in their order); delete one; each confirmed', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const { dialogs } = await open(page, sanity, trackDoc)
    const block = (n: string) => page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: n }) })
    await page.locator('#itl-select-btn').click()
    await expect(page.locator('#itl-select-bar')).toBeVisible()
    await expect(page.locator('#itl-select-move')).toBeDisabled()
    // Ticked, not opened.
    await block('Third').click()
    await block('First').click()
    await expect(page.locator('#itl-detail')).toBeHidden()
    await expect(block('First')).toHaveClass(/itl-selected/)
    await expect(page.locator('#itl-select-count')).toHaveText('2 selected')
    await page.locator('#itl-select-move').click()
    expect(dialogs[0]).toBe('Move 2 stops from 2. mar (tir) to the end of 3. mar (ons)? (A stop with a fixed time goes to its time.)')
    expect(await names(page, 0)).toEqual(['Second', 'Fourth'])
    expect(await names(page, 1)).toEqual(['Other Day Stop', 'First', 'Third'])
    await expect(page.locator('#itl-act-toast')).toContainText('Moved 2 stops to 3. mar (ons).')
    await expect(page.locator('#itl-select-bar')).toBeHidden()
    // Delete one.
    await page.locator('#itl-select-btn').click()
    await block('Fourth').click()
    await page.locator('#itl-select-delete').click()
    expect(dialogs[1]).toBe('Delete 1 stop from 2. mar (tir): Fourth?')
    expect(await names(page, 0)).toEqual(['Second'])
    await expect(page.locator('#itl-act-toast')).toContainText('Deleted 1 stop.')
  })
})
