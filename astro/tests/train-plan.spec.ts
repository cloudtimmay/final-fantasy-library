import { test, expect } from './fixtures'
import { validateTrain, trainTimes, trainSummary } from '../src/lib/train-plan'
import { scheduleDay, reminderTitle, TRAIN_PLATFORM_MIN, TRAIN_EXIT_WALK_MIN } from '../src/lib/itinerary-schedule'

const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }
const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, lat: null, lng: null, durationMin: 30, fixedTime: null, arriveEarlyMin: null, manualTravelMin: null, noteTravelMin: null, ...extra })
const TRAIN = { line: 'Tokaido Line', train: 'Rapid 1234', fromStation: 'Tokyo', departure: '11:00', platform: '9', toStation: 'Odawara', arrival: '12:15', transfers: [] }

test.describe('trains on a leg (lib/train-plan.ts)', () => {
  test('validation: times must be valid HH:MM and in order; texts are trimmed', () => {
    const ok = validateTrain({ ...TRAIN, line: '  Tokaido Line  ', departure: '9:05', arrival: '10:20' })
    expect(ok).toMatchObject({ train: { line: 'Tokaido Line', departure: '09:05', arrival: '10:20' } })
    expect(validateTrain({ ...TRAIN, departure: '25:00' })).toEqual({ error: 'The departure time must be HH:MM.' })
    expect(validateTrain({ ...TRAIN, arrival: 'soon' })).toEqual({ error: 'The arrival time must be HH:MM.' })
    expect(validateTrain({ ...TRAIN, departure: '12:30', arrival: '12:15' })).toEqual({ error: 'The times must be in order: departure, each transfer, then arrival.' })
    expect(validateTrain({ ...TRAIN, transfers: [{ station: 'Shinagawa', line: 'Keikyu', arrival: '11:20', departure: '11:10', platform: '1' }] }))
      .toEqual({ error: 'The times must be in order: departure, each transfer, then arrival.' })
    expect(validateTrain({ ...TRAIN, transfers: [{ station: 'Shinagawa', arrival: '11:2', departure: '11:30' }] })).toEqual({ error: 'Transfer 1: its times must be HH:MM.' })
    // Past midnight once is fine.
    expect(trainTimes({ ...TRAIN, departure: '23:50', arrival: '00:20' }))
      .toEqual({ departure: t('23:50'), arrival: t('00:20') + 1440, walkToStationMin: null })
  })

  test('the summary line', () => {
    expect(trainSummary(TRAIN)).toBe('🚆 Tokaido Line Rapid 1234 · 11:00 platform 9 → Odawara 12:15')
    expect(trainSummary({ ...TRAIN, transfers: [{ station: 'Shinagawa', line: 'Keikyu', arrival: '11:08', departure: '11:15', platform: '2' }] }))
      .toBe('🚆 Tokaido Line Rapid 1234 · 11:00 platform 9 → Odawara 12:15 · +1 transfer')
  })

  test('the schedule: leave-by from the departure, the next stop from the arrival; a stop running too long is flagged', () => {
    const train = trainTimes(TRAIN)!
    let d = scheduleDay([stop('Shop'), stop('Odawara Shop', { train })], t('10:00'), BASE)
    expect(d.stops[0].leaveBy).toBe(t('11:00') - TRAIN_PLATFORM_MIN)
    expect(d.stops[0].leaveEarlierMin).toBeNull() // ends 10:30
    expect(d.stops[1]).toMatchObject({ arrival: t('12:15') + TRAIN_EXIT_WALK_MIN, start: t('12:15') + TRAIN_EXIT_WALK_MIN })
    expect(d.stops[1].travelIn).toMatchObject({ source: 'train', mode: 'train', minutes: t('12:15') + TRAIN_EXIT_WALK_MIN - (t('11:00') - TRAIN_PLATFORM_MIN) })
    // The walk to the station counts too.
    d = scheduleDay([stop('Shop'), stop('Odawara Shop', { train: { ...train, walkToStationMin: 8 } })], t('10:00'), BASE)
    expect(d.stops[0].leaveBy).toBe(t('11:00') - TRAIN_PLATFORM_MIN - 8)
    // Too long before it: "leave earlier", and the segment's overrun with the train's time.
    d = scheduleDay([stop('Long Shop', { durationMin: 75 }), stop('Odawara Shop', { train })], t('10:00'), BASE)
    expect(d.stops[0].leaveEarlierMin).toBe(t('11:15') - t('10:50'))
    d = scheduleDay([stop('A', { durationMin: 40 }), stop('B', { durationMin: 40 }), stop('Odawara Shop', { train })], t('10:00'), BASE)
    expect(d.segments).toEqual([expect.objectContaining({ anchorIndex: 2, anchorTime: t('11:00'), overrunMin: t('11:20') - t('10:50') })])
    expect(d.stops[1].doesntFit).toMatchObject({ anchorIndex: 2, anchorTime: t('11:00') })
  })

  test('a train arriving after a fixed time is flagged; the reminder says which train', () => {
    const train = trainTimes(TRAIN)!
    const d = scheduleDay([stop('Shop'), stop('Fixed Cafe', { train, fixedTime: t('12:15') })], t('10:00'), BASE)
    expect(d.stops[1].trainLateMin).toBe(TRAIN_EXIT_WALK_MIN)
    expect(reminderTitle('Shop', t('10:50'), 'Odawara Shop', '11:00')).toBe('Leave Shop 10:50 JST for the 11:00 train → Odawara Shop')
    expect(reminderTitle('Shop', t('10:50'), 'Odawara Shop')).toBe('Leave Shop 10:50 JST → Odawara Shop')
  })

  test('Check day gets the train in its input', async () => {
    const { buildUserPrompt } = await import('../src/lib/itinerary-review-helpers')
    const prompt = buildUserPrompt('Saturday 5 December 2026', null, '10:00',
      [{ name: 'Shop', plannedTime: t('10:00'), durationMin: 30, lat: null, lng: null }, { name: 'Odawara Shop', plannedTime: t('12:20'), durationMin: 30, lat: null, lng: null }],
      [null, null], [null, null], null, null, [], null, [null, trainSummary(TRAIN).replace(/^🚆 /, '')])
    expect(prompt).toContain('Train here (chosen by the owner; the timetable above uses it): Tokaido Line Rapid 1234 · 11:00 platform 9 → Odawara 12:15')
  })
})

test.describe('/itinerary-list keeps a chosen train', () => {
  test('saving from the list keeps the train on the stop', async ({ page }) => {
    const saves: any[] = []
    await page.route('**/api/itinerary-save', async (route) => {
      saves.push(JSON.parse(route.request().postDataJSON().data))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto('/itinerary-list')
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    const day = await page.evaluate((train) => {
      // @ts-ignore - globals of the list's inline script
      state[0].stops[0].train = train; render(); return state[0].day
    }, TRAIN)
    await page.locator('.day-start-input').first().fill('09:15')
    await page.locator('.day-start-input').first().dispatchEvent('change')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(saves[saves.length - 1].days[day].stops[0].train).toEqual(TRAIN)
  })
})
