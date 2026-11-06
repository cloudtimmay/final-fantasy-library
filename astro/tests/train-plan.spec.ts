import { test, expect } from './fixtures'
import { validateTrain, trainTimes, trainSummary, trainLegText, trainDeparture, trainTravelMinutes, trainFareText, TRAIN_ORDER_ERROR, DEFAULT_WALK_FROM_STATION_MIN } from '../src/lib/train-plan'
import { scheduleDay, reminderTitle, trainEarlyHint, TRAIN_PLATFORM_MIN, TRAIN_EXIT_WALK_MIN } from '../src/lib/itinerary-schedule'

const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }
const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, lat: null, lng: null, durationMin: 30, fixedTime: null, arriveEarlyMin: null, manualTravelMin: null, noteTravelMin: null, ...extra })
// The real route: walk 5 min; Yamanote Line local Akihabara 06:47 (3) → Tokyo 06:51; Tokaido
// Shinkansen Hikari 701 Tokyo 07:03 (15) → Shizuoka 08:02; Tokaido Line local Shizuoka 08:07 (2) →
// Higashi-Shizuoka 08:10.
const ROUTE = {
  walkToStationMin: 5,
  legs: [
    { line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara', departure: '06:47', platform: '3', toStation: 'Tokyo', arrival: '06:51' },
    { line: 'Tokaido Shinkansen', train: 'Hikari 701', fromStation: 'Tokyo', departure: '07:03', platform: '15', toStation: 'Shizuoka', arrival: '08:02' },
    { line: 'Tokaido Line', train: 'local', fromStation: 'Shizuoka', departure: '08:07', platform: '2', toStation: 'Higashi-Shizuoka', arrival: '08:10' },
  ],
}
// A short one-train trip for the schedule cases.
const ONE = { legs: [{ line: 'Tokaido Line', train: 'Rapid 1234', fromStation: 'Tokyo', departure: '11:00', platform: '9', toStation: 'Odawara', arrival: '12:15' }] }
const withLeg = (i: number, change: Record<string, string>) => ({ ...ROUTE, legs: ROUTE.legs.map((l, k) => (k === i ? { ...l, ...change } : l)) })

test.describe('trains on a leg (lib/train-plan.ts): a list of legs', () => {
  test('the real route: valid, its times, the summary, each leg in full', () => {
    expect(validateTrain(ROUTE)).toEqual({ train: ROUTE })
    expect(trainTimes(ROUTE)).toEqual({ departure: t('06:47'), arrival: t('08:10'), walkToStationMin: 5, walkFromStationMin: DEFAULT_WALK_FROM_STATION_MIN })
    expect(trainDeparture(ROUTE)).toBe('06:47')
    expect(trainSummary(ROUTE)).toBe('🚆 06:47 Yamanote → Tokyo · 07:03 Shinkansen Hikari 701 (15) → Shizuoka · 08:07 Tokaido → Higashi-Shizuoka 08:10')
    expect(ROUTE.legs.map(trainLegText)).toEqual([
      '1. Yamanote Line local · Akihabara 06:47 (platform 3) → Tokyo 06:51',
      '2. Tokaido Shinkansen Hikari 701 · Tokyo 07:03 (platform 15) → Shizuoka 08:02',
      '3. Tokaido Line local · Shizuoka 08:07 (platform 2) → Higashi-Shizuoka 08:10',
    ])
  })

  test('validation: every time HH:MM, in order across the legs; texts trimmed; at least one leg', () => {
    expect(validateTrain({ legs: [{ ...ONE.legs[0], line: '  Tokaido Line  ', departure: '9:05', arrival: '10:20' }] }))
      .toMatchObject({ train: { legs: [{ line: 'Tokaido Line', departure: '09:05', arrival: '10:20' }] } })
    expect(validateTrain({ legs: [{ ...ONE.legs[0], departure: '25:00' }] })).toEqual({ error: 'the departure time must be HH:MM.' })
    expect(validateTrain(withLeg(1, { arrival: 'soon' }))).toEqual({ error: 'Train 2: the arrival time must be HH:MM.' })
    expect(validateTrain(withLeg(1, { departure: '06:49' }))).toEqual({ error: TRAIN_ORDER_ERROR }) // before the first train arrives
    expect(validateTrain(withLeg(2, { arrival: '08:05' }))).toEqual({ error: TRAIN_ORDER_ERROR }) // arrives before it leaves
    expect(validateTrain({ legs: [] })).toEqual({ error: 'Add at least one train.' })
    // Past midnight once is fine.
    expect(trainTimes({ legs: [{ ...ONE.legs[0], departure: '23:50', arrival: '00:20' }] })).toEqual({ departure: t('23:50'), arrival: t('00:20') + 1440, walkToStationMin: null, walkFromStationMin: 5 })
  })

  test('a train saved the old way (a main train with transfers) is read as legs', () => {
    const old = {
      line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara', departure: '06:47', platform: '3', toStation: 'Higashi-Shizuoka', arrival: '08:10', walkToStationMin: 5,
      transfers: [
        { station: 'Tokyo', line: 'Tokaido Shinkansen', arrival: '06:51', departure: '07:03', platform: '15' },
        { station: 'Shizuoka', line: 'Tokaido Line', arrival: '08:02', departure: '08:07', platform: '2' },
      ],
    }
    const v = validateTrain(old)
    expect(v).toEqual({ train: { walkToStationMin: 5, legs: [
      { line: 'Yamanote Line', train: 'local', fromStation: 'Akihabara', departure: '06:47', platform: '3', toStation: 'Tokyo', arrival: '06:51' },
      { line: 'Tokaido Shinkansen', train: '', fromStation: 'Tokyo', departure: '07:03', platform: '15', toStation: 'Shizuoka', arrival: '08:02' },
      { line: 'Tokaido Line', train: '', fromStation: 'Shizuoka', departure: '08:07', platform: '2', toStation: 'Higashi-Shizuoka', arrival: '08:10' },
    ] } })
    expect(trainTimes(old)).toEqual(trainTimes(ROUTE))
  })

  test('the schedule: leave-by from the first departure, the next stop from the last arrival; a stop running too long is flagged', () => {
    const train = trainTimes(ONE)!
    let d = scheduleDay([stop('Shop'), stop('Odawara Shop', { train })], t('10:00'), BASE)
    expect(d.stops[0].leaveBy).toBe(t('11:00') - TRAIN_PLATFORM_MIN)
    expect(d.stops[0].leaveEarlierMin).toBeNull() // ends 10:30
    expect(d.stops[1]).toMatchObject({ arrival: t('12:15') + TRAIN_EXIT_WALK_MIN, start: t('12:15') + TRAIN_EXIT_WALK_MIN })
    expect(d.stops[1].travelIn).toMatchObject({ source: 'train', mode: 'train', minutes: t('12:15') + TRAIN_EXIT_WALK_MIN - (t('11:00') - TRAIN_PLATFORM_MIN) })
    // The real route, with its 5-min walk: leave the stop before by 06:47 − 10 − 5.
    d = scheduleDay([stop('Hotel Breakfast'), stop('Shizuoka Shop', { train: trainTimes(ROUTE) })], t('06:00'), BASE)
    expect(d.stops[0].leaveBy).toBe(t('06:32'))
    expect(d.stops[1].start).toBe(t('08:10') + TRAIN_EXIT_WALK_MIN)
    // Too long before it: "leave earlier", and the segment's overrun with the train's time.
    d = scheduleDay([stop('Long Shop', { durationMin: 75 }), stop('Odawara Shop', { train })], t('10:00'), BASE)
    expect(d.stops[0].leaveEarlierMin).toBe(t('11:15') - t('10:50'))
    d = scheduleDay([stop('A', { durationMin: 40 }), stop('B', { durationMin: 40 }), stop('Odawara Shop', { train })], t('10:00'), BASE)
    expect(d.segments).toEqual([expect.objectContaining({ anchorIndex: 2, anchorTime: t('11:00'), overrunMin: t('11:20') - t('10:50') })])
    expect(d.stops[1].doesntFit).toMatchObject({ anchorIndex: 2, anchorTime: t('11:00') })
  })

  test('a fixed time: too late is flagged; much too early (over 30 min) gets the hint; the reminder says which train', () => {
    const route = trainTimes(ROUTE)!
    let d = scheduleDay([stop('Hotel'), stop('Fixed Tour', { train: route, fixedTime: t('08:10') })], t('06:00'), BASE)
    expect(d.stops[1].trainLateMin).toBe(TRAIN_EXIT_WALK_MIN)
    d = scheduleDay([stop('Hotel'), stop('Fixed Tour', { train: route, fixedTime: t('09:30') })], t('06:00'), BASE)
    expect(d.stops[1].trainEarly).toEqual({ arrival: t('08:15'), fixedTime: t('09:30') })
    expect(trainEarlyHint(d.stops[1].trainEarly!)).toBe('Arrives 08:15, 75 min before 09:30. A later train may be possible.')
    d = scheduleDay([stop('Hotel'), stop('Fixed Tour', { train: route, fixedTime: t('08:40') })], t('06:00'), BASE)
    expect(d.stops[1].trainEarly).toBeNull() // 25 min: fine
    expect(reminderTitle('Hotel', t('06:32'), 'Shizuoka Shop', '06:47')).toBe('Leave Hotel 06:32 JST for the 06:47 train → Shizuoka Shop')
  })

  test('Check day gets the train in its input', async () => {
    const { buildUserPrompt } = await import('../src/lib/itinerary-review-helpers')
    const prompt = buildUserPrompt('Saturday 5 December 2026', null, '06:00',
      [{ name: 'Hotel', plannedTime: t('06:00'), durationMin: 30, lat: null, lng: null }, { name: 'Shizuoka Shop', plannedTime: t('08:15'), durationMin: 30, lat: null, lng: null }],
      [null, null], [null, null], null, null, [], null, [null, trainSummary(ROUTE).replace(/^🚆 /, '')])
    expect(prompt).toContain('Train here (chosen by the owner; the timetable above uses it): 06:47 Yamanote → Tokyo · 07:03 Shinkansen Hikari 701 (15) → Shizuoka · 08:07 Tokaido → Higashi-Shizuoka 08:10')
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
    }, ROUTE)
    await page.locator('.day-start-input').first().fill('09:15')
    await page.locator('.day-start-input').first().dispatchEvent('change')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(saves[saves.length - 1].days[day].stops[0].train).toEqual(ROUTE)
  })
})

test.describe('reading a train from a screenshot (lib/train-plan.ts trainFromModelText)', () => {
  test('legs with their train names and platforms, and the walk; fenced or after other text; invalid or out-of-order times are refused', async () => {
    const { trainFromModelText } = await import('../src/lib/train-plan')
    const answer = JSON.stringify(ROUTE)
    expect(trainFromModelText(answer)).toEqual({ train: ROUTE })
    expect(trainFromModelText('```json\n' + answer + '\n```')).toMatchObject({ train: { legs: [{ line: 'Yamanote Line' }, { train: 'Hikari 701', platform: '15' }, {}] } })
    expect(trainFromModelText('Here is the route:\n' + answer)).toMatchObject({ train: { walkToStationMin: 5 } })
    expect(trainFromModelText(JSON.stringify(withLeg(0, { departure: '' })))).toEqual({ error: 'Train 1: the departure time must be HH:MM.' })
    expect(trainFromModelText(JSON.stringify(withLeg(2, { departure: '07:50' })))).toEqual({ error: TRAIN_ORDER_ERROR })
    expect(trainFromModelText('I could not read this image.')).toEqual({ error: 'Could not read a train from the screenshot.' })
  })
})

test.describe('Suggest route with a planned train', () => {
  test('the train leg stays intact (the stops before and after it keep their places); the others are reordered around it', async () => {
    const { optimizeRoute } = await import('../src/lib/route-optimizer')
    const { optimizerInput } = await import('../src/lib/itinerary-plan')
    const at = (lat: number, name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat, lng: 139.77, dur: 30, ...extra })
    // Far, Near, Before Train, After Train (the train leg), Far2, Near2: badly ordered around it.
    const day = {
      day: '2026-12-05', date: '5. des', area: '', note: '', startTime: '10:00',
      stops: [at(35.75, 'Far'), at(35.698, 'Near'), at(35.70, 'Before Train'), at(35.465, 'After Train', { train: { legs: [{ ...ONE.legs[0], departure: '12:00', arrival: '12:40' }] } }), at(35.47, 'Far2'), at(35.466, 'Near2')],
    }
    const input = optimizerInput(day as any, { base: BASE, shopById: new Map() })
    expect(input.stops.map((s) => !!s.locked)).toEqual([false, false, true, true, false, false])
    const result = optimizeRoute(input.stops, input.startTime, input.start, input.weekday, input.date)
    expect(result.order.indexOf(2)).toBe(2) // Before Train
    expect(result.order.indexOf(3)).toBe(3) // After Train, right after it
    expect(new Set(result.order)).toEqual(new Set([0, 1, 2, 3, 4, 5]))
    expect(result.order.slice(0, 2)).toEqual([1, 0]) // the near one first now
    // The train sets the time after the leg.
    expect(result.suggested.times[3]).toBe(t('12:40') + TRAIN_EXIT_WALK_MIN)
  })
})

// The whole Google Maps route: 1 hr 40 min, ¥6,670 — 5 min to Akihabara Station, the trains
// 06:47–08:10, then about 12 min from Higashi-Shizuoka Station to the museum (there at 08:22).
const FULL = { ...ROUTE, walkFromStationMin: 12, fareYen: 6670 }

test.describe('a train trip\'s walks, travel time and fare', () => {
  test('both walks and the fare are kept; the walk from the last station is 5 min when not known; bad values are dropped', () => {
    expect(validateTrain(FULL)).toEqual({ train: FULL })
    expect(validateTrain({ ...ROUTE, fareYen: '¥6,670', walkFromStationMin: '12' })).toEqual({ train: FULL })
    expect(trainTimes(FULL)).toEqual({ departure: t('06:47'), arrival: t('08:10'), walkToStationMin: 5, walkFromStationMin: 12 })
    expect(trainTimes(ROUTE)!.walkFromStationMin).toBe(5)
    expect(validateTrain({ ...ROUTE, fareYen: -5, walkFromStationMin: 90 })).toEqual({ train: ROUTE })
    expect(validateTrain({ ...ROUTE, fareYen: '', walkFromStationMin: '' })).toEqual({ train: ROUTE })
  })

  test('travel time: 5 + (06:47→08:10 = 83) + 12 = 100 min, as Google\'s 1 hr 40 min', () => {
    expect(trainTravelMinutes(FULL)).toBe(100)
    expect(trainTravelMinutes(ROUTE)).toBe(5 + 83 + 5)
    expect(trainTravelMinutes(null)).toBeNull()
  })

  test('the schedule: the next stop starts after the walk from the last station (08:22); the hint uses that arrival', () => {
    let d = scheduleDay([stop('Hotel Breakfast'), stop('Shizuoka Museum', { train: trainTimes(FULL) })], t('06:00'), BASE)
    expect(d.stops[0].leaveBy).toBe(t('06:32'))
    expect(d.stops[1].start).toBe(t('08:22'))
    d = scheduleDay([stop('Hotel Breakfast'), stop('Shizuoka Museum', { train: trainTimes(FULL), fixedTime: t('09:30') })], t('06:00'), BASE)
    expect(trainEarlyHint(d.stops[1].trainEarly!)).toBe('Arrives 08:22, 68 min before 09:30. A later train may be possible.')
  })

  test('the fare: "¥6,670 per person" with ≈ NOK at the trip\'s rate; nothing without a fare', () => {
    expect(trainFareText(FULL, 0.064)).toBe('¥6,670 per person (≈ 427 kr)')
    expect(trainFareText(FULL, null)).toBe('¥6,670 per person')
    expect(trainFareText(ROUTE, 0.064)).toBe('')
  })

  test('read from the screenshot: the fare (¥6,670) and both walks', async () => {
    const { trainFromModelText } = await import('../src/lib/train-plan')
    expect(trainFromModelText(JSON.stringify({ ...ROUTE, walkFromStationMin: 12, fareYen: 6670 }))).toEqual({ train: FULL })
    expect(trainFromModelText(JSON.stringify({ ...ROUTE, walkFromStationMin: null, fareYen: '¥6,670' }))).toEqual({ train: { ...ROUTE, fareYen: 6670 } })
  })
})

test.describe('trains on the last legs, and travelers', () => {
  const ONE_BACK = { walkToStationMin: 5, walkFromStationMin: 5, fareYen: 670, legs: [{ line: 'Tokaido Line', train: 'local', fromStation: 'Shizuoka', departure: '18:00', platform: '1', toStation: 'Tokyo', arrival: '18:40' }] }

  test('a train back to the base: the last stop must be left by its leave-by; the day ends at its arrival + the walk', () => {
    let d = scheduleDay([stop('Shizuoka Shop', { durationMin: 60 })], t('16:00'), BASE, { returnTrain: trainTimes(ONE_BACK) })
    expect(d.stops[0]).toMatchObject({ leaveBy: t('17:45'), latestLeave: t('17:45'), leaveEarlierMin: null })
    expect(d.returnLeg).toMatchObject({ source: 'train', mode: 'train' })
    expect(d.end).toBe(t('18:45'))
    // Staying too long: "leave earlier", and the stop before counts back from the train too.
    d = scheduleDay([stop('First', { durationMin: 30 }), stop('Shizuoka Shop', { durationMin: 120 })], t('16:00'), BASE, { returnTrain: trainTimes(ONE_BACK) })
    expect(d.stops[1].leaveEarlierMin).toBe(d.stops[1].end - t('17:45'))
    expect(d.stops[0].latestLeave).toBe(t('17:45') - 120 - d.stops[1].travelIn.minutes)
    // Without it: as before (the estimate).
    expect(scheduleDay([stop('Shizuoka Shop')], t('16:00'), BASE).returnLeg).toMatchObject({ source: 'estimate' })
  })

  test('the flight day: a train to the airport sets when to leave, and flags arriving after check-in', async () => {
    const { flightDeadline } = await import('../src/lib/itinerary-plan')
    const flight = { date: '2027-03-05', time: '09:55', airport: 'Haneda' }
    const train = (dep: string, arr: string) => ({ walkToStationMin: 5, walkFromStationMin: 10, legs: [{ line: 'Keikyu Line', train: 'Airport Express', fromStation: 'Shinagawa', departure: dep, platform: '2', toStation: 'Haneda Airport Terminal 3', arrival: arr }] })
    expect(flightDeadline({ day: '2027-03-05' }, flight)).toEqual({ leaveBy: t('05:55'), train: false, atAirport: null, checkInBy: t('06:55'), late: false })
    expect(flightDeadline({ day: '2027-03-05', airportTrain: train('05:30', '05:50') as any }, flight)).toEqual({ leaveBy: t('05:15'), train: true, atAirport: t('06:00'), checkInBy: t('06:55'), late: false })
    expect(flightDeadline({ day: '2027-03-05', airportTrain: train('06:30', '06:50') as any }, flight)).toMatchObject({ leaveBy: t('06:15'), atAirport: t('07:00'), late: true })
    expect(flightDeadline({ day: '2027-03-04' }, flight)).toBeNull()
  })

  test('fares × travelers: the number on the train, else the trip, else 5; the day total', async () => {
    const { dayTrainFares, dayTrainFaresText } = await import('../src/lib/itinerary-plan')
    expect(trainFareText(FULL, 0.064, null)).toBe('¥6,670 per person (≈ 427 kr) · ¥6,670 × 5 = ¥33,350')
    expect(trainFareText(FULL, 0.064, 4)).toBe('¥6,670 per person (≈ 427 kr) · ¥6,670 × 4 = ¥26,680')
    expect(trainFareText({ ...FULL, travelers: 2 }, null, 4)).toBe('¥6,670 per person · ¥6,670 × 2 = ¥13,340')
    expect(validateTrain({ ...FULL, travelers: '3' })).toEqual({ train: { ...FULL, travelers: 3 } })
    expect(validateTrain({ ...FULL, travelers: 0 })).toEqual({ train: FULL })
    // A day: the real route out, the train back.
    const day: any = { day: '2026-12-05', stops: [{ name: 'Hotel' }, { name: 'Shizuoka', train: FULL }], returnTrain: ONE_BACK }
    const sched = scheduleDay([stop('Hotel'), stop('Shizuoka', { train: trainTimes(FULL) })], t('06:00'), BASE, { returnTrain: trainTimes(ONE_BACK) })
    const fares = dayTrainFares(day, sched, new Map(), null)
    expect(fares).toEqual({ totalYen: 7340, groupYen: 36700, travelers: 5, estimate: false })
    expect(dayTrainFaresText(fares, 0.064)).toBe('🚆 Trains today: ¥7,340 per person (≈ 470 kr) · ¥36,700 for 5')
    // The trip's own number, and one train with its own.
    expect(dayTrainFaresText(dayTrainFares(day, sched, new Map(), 4), null)).toBe('🚆 Trains today: ¥7,340 per person · ¥29,360 for 4')
    const mixed = dayTrainFares({ ...day, returnTrain: { ...ONE_BACK, travelers: 2 } }, sched, new Map(), null)
    expect(mixed).toEqual({ totalYen: 7340, groupYen: 6670 * 5 + 670 * 2, travelers: null, estimate: false })
    expect(dayTrainFaresText(mixed, null)).toBe('🚆 Trains today: ¥7,340 per person · ¥34,690 for everyone')
  })
})

// The real case: 6 Dec 2026, flight 23:00 from Narita (T1); the last stop in Shinjuku, then the
// Narita Express: walk 10 min, Shinjuku 18:15 → Narita Airport Terminal 1 19:40, walk 5 min.
const NEX = { walkToStationMin: 10, walkFromStationMin: 5, legs: [{ line: 'Narita Express', train: 'NEX 37', fromStation: 'Shinjuku', departure: '18:15', platform: '5', toStation: 'Narita Airport Terminal 1', arrival: '19:40' }] }

test.describe('the train to the airport from the last stop, and Check day', () => {
  test('the leg after the last stop: its leave-by, Latest and Fix follow the train; the day ends at the airport', async () => {
    const { computeDayTimes, lastLegTrain, latestLeaveFor, leaveFixFor, flightDeadline } = await import('../src/lib/itinerary-plan')
    const day: any = { day: '2026-12-06', startTime: '16:00', stops: [{ name: 'Shinjuku Shop', lat: 35.6905, lng: 139.7005, dur: 90, travelMin: 0, travelFrom: '__base__' }], airportTrain: NEX }
    expect(lastLegTrain(day)).toEqual({ train: NEX, toAirport: true })
    let { sched } = computeDayTimes(day, BASE, new Map())
    expect(sched.stops[0]).toMatchObject({ end: t('17:30'), leaveBy: t('17:55'), leaveEarlierMin: null }) // 18:15 − 10 − 10
    expect(sched.end).toBe(t('19:45')) // at the airport: 19:40 + 5
    expect(latestLeaveFor(sched, 0)).toBe(t('17:55'))
    expect(flightDeadline(day, { date: '2026-12-06', time: '23:00', airport: 'Narita' })).toMatchObject({ leaveBy: t('17:55'), atAirport: t('19:45'), checkInBy: t('20:00'), late: false })
    // Staying too long: leave earlier, and the fix is the train's leave-by.
    ;({ sched } = computeDayTimes({ ...day, stops: [{ ...day.stops[0], dur: 150 }] }, BASE, new Map()))
    expect(sched.stops[0].leaveEarlierMin).toBe(t('18:30') - t('17:55'))
    expect(leaveFixFor(sched, 0)).toBe(t('17:55'))
    // Without stops: no leg after a stop — the train leaves from the base (flightDeadline).
    expect(lastLegTrain({ ...day, stops: [] }).toAirport).toBe(false)
  })

  test('Check day gets the train; the deadline is its arrival at the airport, not the fixed estimate', async () => {
    const { checkDayRequestBody } = await import('../src/lib/itinerary-plan')
    const { flightDeadlineWarning, buildUserPrompt } = await import('../src/lib/itinerary-review-helpers')
    const day: any = { day: '2026-12-06', date: '6. des (søn)', area: 'Shinjuku', startTime: '16:00', stops: [{ name: 'Shinjuku Shop', lat: 35.6905, lng: 139.7005, dur: 90 }], airportTrain: NEX }
    const body = checkDayRequestBody(day, { base: BASE, shopById: new Map(), flight: { date: '2026-12-06', time: '23:00', airport: 'Narita', terminal: 'T1' } })
    expect(body.flight).toEqual({ time: '23:00', airport: 'Narita', terminal: 'T1', airportTrain: NEX })
    expect('returnTrain' in body).toBe(false)
    const flight = { time: '23:00', airport: 'Narita', terminal: 'T1' }
    const stops = [{ name: 'Shinjuku Shop', plannedTime: t('16:00'), durationMin: 90, lat: 35.6905, lng: 139.7005 }]
    // At the airport 19:45, before check-in closes at 20:00: no warning — even though the old
    // estimate (leave central Tokyo by 18:30) would be fine here too; a later train is flagged.
    expect(flightDeadlineWarning(stops, flight, t('19:45'), { leaveBy: t('17:55'), atAirport: t('19:45') })).toBeNull()
    expect(flightDeadlineWarning(stops, flight, t('20:25'), { leaveBy: t('18:35'), atAirport: t('20:25') })).toMatchObject({
      severity: 'warning', message: 'The train to the airport gets there at 20:25, but for the 23:00 flight from Narita you should be there by 20:00 (3 hours before).',
    })
    // A late last stop with the train in time: the train decides, not "end by 18:30".
    expect(flightDeadlineWarning([{ ...stops[0], durationMin: 150 }], flight, t('19:45'), { leaveBy: t('17:55'), atAirport: t('19:45') })).toBeNull()
    const prompt = buildUserPrompt('Sunday 6 December 2026', 'Shinjuku', '16:00', stops as any, [null], [null], flight, null, [], null, [null],
      { summary: '18:15 Narita Express NEX 37 (5) → Narita Airport Terminal 1 19:40', leaveBy: t('17:55'), atAirport: t('19:45') })
    expect(prompt).toContain('Train to the airport, chosen by the owner, from the day\'s last stop: 18:15 Narita Express NEX 37 (5) → Narita Airport Terminal 1 19:40. Leave the last stop by 17:55; it reaches the airport at 19:45.')
    expect(prompt).toContain('so by 20:00')
    expect(prompt).not.toContain('allow about 90 minutes')
  })

  test('the list\'s "Next" banner: leave the last stop for the airport train', async ({ page, sanity, trackDoc }) => {
    const trip = await sanity.create({ _type: 'tripSettings', label: `[test] NEX Trip ${Date.now()}`, firstTokyoDay: '2026-12-05', lastTokyoDay: '2026-12-06', flightHomeDate: '2026-12-06', flightHomeTime: '23:00', flightHomeAirport: 'Narita', flightHomeTerminal: 'T1' })
    trackDoc(trip._id)
    await page.route('**/api/itinerary-save', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.clock.setFixedTime(new Date('2026-12-06T17:00:00+09:00'))
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate((nex) => {
      // @ts-ignore - globals of the list's inline script
      const d = state.find((x) => x.day === '2026-12-06'); d.startTime = '16:00'
      d.stops = [{ name: 'Shinjuku Shop', hours: '', tag: '', slot: '', lat: 35.6905, lng: 139.7005, dur: 90, travelMin: 0, travelFrom: '__base__' }]
      d.airportTrain = nex
      // @ts-ignore
      render()
    }, NEX)
    await expect(page.locator('#itn-next')).toHaveText('Next: leave Shinjuku Shop by 17:55 for Narita Airport (in 55 min)')
  })
})
