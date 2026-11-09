import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { validateReviewAction, modelReviewItems, reviewActionLabel, normalizeReviewAction } from '../src/lib/itinerary-review-helpers'
import { applyReviewAction } from '../src/lib/itinerary-plan'

// Check day's suggestions as changes: checked on the server against the plan, applied only on
// "Apply", with Undo. The AI is always mocked.
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const CTX = {
  stops: [
    { name: 'Animate', plannedTime: t('10:00'), durationMin: 60 },
    { name: 'Super Potato', plannedTime: t('11:10'), durationMin: 45 },
    { name: 'Lunch', plannedTime: t('12:00'), durationMin: 60 },
  ],
  dayDate: '2026-12-05',
  tripDays: ['2026-12-05', '2026-12-06', '2026-12-07'],
}

test.describe('Check day actions: checked on the server (lib/itinerary-review-helpers.ts)', () => {
  test('each action type, with the stop\'s name from the plan', () => {
    expect(validateReviewAction({ type: 'set_leave_time', leaveAt: '10:40' }, 0, CTX)).toEqual({ type: 'set_leave_time', stopIndex: 0, stopName: 'Animate', leaveAt: '10:40' })
    expect(validateReviewAction({ type: 'change_duration', durationMin: 30 }, 1, CTX)).toEqual({ type: 'change_duration', stopIndex: 1, stopName: 'Super Potato', durationMin: 30 })
    expect(validateReviewAction({ type: 'move_position', toIndex: 0 }, 2, CTX)).toEqual({ type: 'move_position', stopIndex: 2, stopName: 'Lunch', toIndex: 0 })
    expect(validateReviewAction({ type: 'move_day', toDate: '2026-12-07' }, 1, CTX)).toEqual({ type: 'move_day', stopIndex: 1, stopName: 'Super Potato', toDate: '2026-12-07' })
    expect(validateReviewAction({ type: 'remove_stop' }, 2, CTX)).toEqual({ type: 'remove_stop', stopIndex: 2, stopName: 'Lunch' })
    expect(reviewActionLabel({ type: 'move_position', stopIndex: 2, stopName: 'Lunch', toIndex: 0 })).toBe('Move to place 1')
  })

  test('anything that doesn\'t apply is dropped', () => {
    const no = (raw: unknown, idx: number | null = 0) => expect(validateReviewAction(raw, idx, CTX)).toBeNull()
    no({ type: 'reorder_everything' })
    no({ type: 'remove_stop' }, null) // no stop
    no({ type: 'remove_stop' }, 3) // no such stop
    no({ type: 'set_leave_time', leaveAt: '09:30' }) // before it starts
    no({ type: 'set_leave_time', leaveAt: '11:00' }) // its end already: no change
    no({ type: 'set_leave_time', leaveAt: '25:00' })
    no({ type: 'change_duration', durationMin: 60 }) // the same
    no({ type: 'change_duration', durationMin: 2 })
    no({ type: 'change_duration', durationMin: 45.5 }, 2)
    no({ type: 'move_position', toIndex: 0 }) // where it is
    no({ type: 'move_position', toIndex: 7 })
    no({ type: 'move_day', toDate: '2026-12-05' }) // this day
    no({ type: 'move_day', toDate: '2026-12-24' }) // not a day of the trip
  })

  test('the model\'s items: an invalid action is dropped and the item kept; a valid one kept', () => {
    const items = modelReviewItems([
      { severity: 'warning', stopIndex: 1, message: 'Too long here.', suggestion: 'Shorter.', action: { type: 'change_duration', durationMin: 30 } },
      { severity: 'tip', stopIndex: 0, message: 'Move it.', suggestion: null, action: { type: 'move_day', toDate: '2027-01-01' } },
      { severity: 'nonsense', stopIndex: 0, message: 'x' },
    ], CTX, 8)
    expect(items).toEqual([
      { severity: 'warning', stopIndex: 1, message: 'Too long here.', suggestion: 'Shorter.', action: { type: 'change_duration', stopIndex: 1, stopName: 'Super Potato', durationMin: 30 } },
      { severity: 'tip', stopIndex: 0, message: 'Move it.', suggestion: null },
    ])
  })
})

test.describe('Check day actions: applied to the plan (lib/itinerary-plan.ts applyReviewAction)', () => {
  const dayOf = () => ({
    day: '2026-12-05', date: '', area: '', note: '', startTime: '10:00',
    stops: [{ name: 'Animate', dur: 60, leaveAt: undefined as string | undefined }, { name: 'Super Potato', dur: 45, leaveAt: '12:00' as string | undefined }, { name: 'Lunch', dur: 60 }],
  }) as any
  const none = () => undefined

  test('each type; a stop that is no longer there (or renamed) is refused', () => {
    let d = dayOf()
    expect(applyReviewAction(d, { type: 'set_leave_time', stopIndex: 0, stopName: 'Animate', leaveAt: '10:40' }, new Map(), none)).toBe(true)
    expect(d.stops[0].leaveAt).toBe('10:40')
    d = dayOf()
    expect(applyReviewAction(d, { type: 'change_duration', stopIndex: 1, stopName: 'Super Potato', durationMin: 30 }, new Map(), none)).toBe(true)
    expect(d.stops[1]).toMatchObject({ dur: 30 })
    expect(d.stops[1].leaveAt).toBeUndefined() // the leave time would have overridden it
    d = dayOf()
    expect(applyReviewAction(d, { type: 'move_position', stopIndex: 2, stopName: 'Lunch', toIndex: 0 }, new Map(), none)).toBe(true)
    expect(d.stops.map((s: any) => s.name)).toEqual(['Lunch', 'Animate', 'Super Potato'])
    d = dayOf()
    const other: any = { day: '2026-12-07', stops: [{ name: 'Nakano' }] }
    expect(applyReviewAction(d, { type: 'move_day', stopIndex: 1, stopName: 'Super Potato', toDate: '2026-12-07' }, new Map(), (date) => (date === '2026-12-07' ? other : undefined))).toBe(true)
    expect(d.stops.map((s: any) => s.name)).toEqual(['Animate', 'Lunch'])
    expect(other.stops.map((s: any) => s.name)).toEqual(['Nakano', 'Super Potato'])
    d = dayOf()
    expect(applyReviewAction(d, { type: 'remove_stop', stopIndex: 2, stopName: 'Lunch' }, new Map(), none)).toBe(true)
    expect(d.stops).toHaveLength(2)
    // The plan changed since the check: refused, nothing changes.
    d = dayOf()
    expect(applyReviewAction(d, { type: 'remove_stop', stopIndex: 1, stopName: 'Lunch' }, new Map(), none)).toBe(false)
    expect(d.stops).toHaveLength(3)
  })
})

test.describe('/itinerary: Check day suggestions with "Apply" and Undo', () => {
  async function open(page: Page, sanity: any, trackDoc: (id: string) => void, items: unknown[]) {
    const trip = await sanity.create({ _type: 'tripSettings', label: testName(`Review Actions Trip ${Date.now()}`), firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-07' })
    trackDoc(trip._id)
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    const reviews: any[] = []
    await page.route('**/api/itinerary-review', async (route) => {
      reviews.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) })
    })
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl
      itl.state[0].startTime = '10:00'
      itl.state[0].stops = [
        { name: 'Animate', hours: '', tag: '', slot: '', lat: 35.700494, lng: 139.771743, dur: 60, travelMin: 0, travelFrom: '__base__' },
        { name: 'Super Potato', hours: '', tag: '', slot: '', lat: 35.699358, lng: 139.770702, dur: 45 },
        { name: 'Lunch', hours: '', tag: '', slot: '', lat: 35.699031, lng: 139.770140, dur: 60 },
      ]
      itl.state[2].stops = [{ name: 'Nakano Day Stop', hours: '', tag: '', slot: '', lat: 35.709, lng: 139.6655, dur: 60 }]
      itl.render()
    })
    return { saves, reviews }
  }
  const names = (page: Page, i = 0) => page.evaluate((d) => (window as any).__itl.state[d].stops.map((s: any) => s.name), i)
  const item = (action: Record<string, unknown>, stopIndex: number, stopName: string) => ({ severity: 'tip', stopIndex, message: `About ${stopName}.`, suggestion: 'Change it.', action: { ...action, stopIndex, stopName } })

  test('each action applies, saved; Undo puts the plan back; nothing changes before "Apply"', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const { saves, reviews } = await open(page, sanity, trackDoc, [
      item({ type: 'set_leave_time', leaveAt: '10:40' }, 0, 'Animate'),
      item({ type: 'change_duration', durationMin: 30 }, 1, 'Super Potato'),
      item({ type: 'move_position', toIndex: 0 }, 2, 'Lunch'),
      item({ type: 'move_day', toDate: '2026-12-07' }, 1, 'Super Potato'),
      item({ type: 'remove_stop' }, 2, 'Lunch'),
    ])
    await page.locator('#itl-check-btn').click()
    const buttons = page.locator('#itl-check-results .ir-apply-btn')
    await expect(buttons).toHaveText(['Apply: Leave at 10:40', 'Apply: Make it 30 min', 'Apply: Move to place 1', 'Apply: Move to 2026-12-07', 'Apply: Remove it'])
    expect(reviews[0].tripDays).toEqual(['2026-12-05', '2026-12-06', '2026-12-07'])
    expect(await names(page)).toEqual(['Animate', 'Super Potato', 'Lunch']) // nothing applied by itself
    const savesBefore = saves.length
    const row = (i: number) => page.locator('#itl-check-results .ir-apply-row').nth(i)
    const stop = (i: number) => page.evaluate((k) => (window as any).__itl.state[0].stops[k], i)

    // Leave at 10:40, saved; Undo.
    await buttons.nth(0).click()
    await expect(row(0)).toContainText('Applied ✓')
    expect((await stop(0)).leaveAt).toBe('10:40')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(savesBefore)
    expect(saves[saves.length - 1].days['2026-12-05'].stops[0].leaveAt).toBe('10:40')
    await row(0).locator('.ir-undo-btn').click()
    await expect(row(0)).toHaveText('Undone.')
    expect((await stop(0)).leaveAt).toBeUndefined()
    await expect.poll(() => saves[saves.length - 1].days['2026-12-05'].stops[0].leaveAt, { timeout: 10000 }).toBeUndefined()

    // 30 min; Undo.
    await buttons.nth(0).click() // the remaining Apply buttons shift: this is "Make it 30 min"
    expect((await stop(1)).dur).toBe(30)
    await row(1).locator('.ir-undo-btn').click()
    expect((await stop(1)).dur).toBe(45)

    // Lunch first; Undo.
    await buttons.nth(0).click()
    expect(await names(page)).toEqual(['Lunch', 'Animate', 'Super Potato'])
    await row(2).locator('.ir-undo-btn').click()
    expect(await names(page)).toEqual(['Animate', 'Super Potato', 'Lunch'])

    // To 7 December; Undo restores both days.
    await buttons.nth(0).click()
    expect(await names(page)).toEqual(['Animate', 'Lunch'])
    expect(await names(page, 2)).toEqual(['Nakano Day Stop', 'Super Potato'])
    await row(3).locator('.ir-undo-btn').click()
    expect(await names(page)).toEqual(['Animate', 'Super Potato', 'Lunch'])
    expect(await names(page, 2)).toEqual(['Nakano Day Stop'])

    // Remove; Undo.
    await buttons.nth(0).click()
    expect(await names(page)).toEqual(['Animate', 'Super Potato'])
    await row(4).locator('.ir-undo-btn').click()
    expect(await names(page)).toEqual(['Animate', 'Super Potato', 'Lunch'])
    await expect.poll(() => saves[saves.length - 1].days['2026-12-05'].stops.map((s: any) => s.name), { timeout: 10000 }).toEqual(['Animate', 'Super Potato', 'Lunch'])
  })

  test('a suggestion whose stop has moved since is refused, not applied to another stop', async ({ page, sanity, trackDoc }) => {
    await open(page, sanity, trackDoc, [item({ type: 'remove_stop' }, 0, 'Animate'), item({ type: 'remove_stop' }, 1, 'Super Potato')])
    await page.locator('#itl-check-btn').click()
    await page.locator('#itl-check-results .ir-apply-btn').first().click() // Animate removed: Super Potato is now first
    await page.locator('#itl-check-results .ir-apply-btn').first().click() // "Super Potato at place 2" no longer holds
    await expect(page.locator('#itl-check-results .ir-apply-row').nth(1)).toHaveText('No longer applies (the plan has changed).')
    expect(await names(page)).toEqual(['Super Potato', 'Lunch'])
  })
})

test.describe('Check day actions: the forms the model sends them in', () => {
  test('other type names, snake_case keys, numbers as strings, 12-hour times — made canonical, then checked as before', () => {
    expect(validateReviewAction({ type: 'shorten', duration_min: '30' }, 1, CTX)).toMatchObject({ type: 'change_duration', durationMin: 30 })
    expect(validateReviewAction({ action: 'leave_at', time: '10:40 AM' }, 0, CTX)).toMatchObject({ type: 'set_leave_time', leaveAt: '10:40' })
    expect(validateReviewAction({ type: 'set_leave_time', leaveAt: '1:15 pm' }, 2, CTX)).toMatchObject({ leaveAt: '13:15' })
    expect(validateReviewAction({ type: 'Set leave time', leave_at: '12.30' }, 1, CTX)).toMatchObject({ leaveAt: '12:30' })
    expect(validateReviewAction('remove', 2, CTX)).toMatchObject({ type: 'remove_stop', stopName: 'Lunch' })
    expect(validateReviewAction({ type: 'reorder', new_index: '0' }, 2, CTX)).toMatchObject({ type: 'move_position', toIndex: 0 })
    expect(validateReviewAction({ type: 'move_to_day', date: '2026-12-07' }, 1, CTX)).toMatchObject({ type: 'move_day', toDate: '2026-12-07' })
    expect(validateReviewAction({ type: 'change_duration', stop_index: 1, minutes: '45 min' }, null, CTX)).toBeNull() // 45 = no change
    expect(validateReviewAction({ type: 'change_duration', stop_index: 1, minutes: '20 min' }, null, CTX)).toMatchObject({ stopIndex: 1, durationMin: 20 })
    // Still refused: no time ("9"), an unknown type, a time before the visit.
    expect(validateReviewAction({ type: 'set_leave_time', leaveAt: '9' }, 0, CTX)).toBeNull()
    expect(validateReviewAction({ type: 'teleport' }, 0, CTX)).toBeNull()
    expect(validateReviewAction({ type: 'leave', time: '9:30 am' }, 0, CTX)).toBeNull()
    expect(normalizeReviewAction(['set_leave_time'])).toBeNull()
  })

  test('the model\'s items with those forms keep their action', () => {
    const items = modelReviewItems([
      { severity: 'warning', stopIndex: 1, message: 'Too long at Super Potato.', suggestion: 'Shorten it.', action: { type: 'shorten', duration_min: '30' } },
      { severity: 'tip', stopIndex: 0, message: 'Leave Animate a bit earlier.', suggestion: null, action: { action: 'leave_at', time: '10:45 AM' } },
    ], CTX, 8)
    expect(items.map((i) => i.action && reviewActionLabel(i.action))).toEqual(['Make it 30 min', 'Leave at 10:45'])
  })
})
