import { test, expect } from './fixtures'
import { isMealStop, suggestsAddingExisting, modelReviewItems, buildUserPrompt } from '../src/lib/itinerary-review-helpers'
import { optimizerInput, checkDayRequestBody, stopIsMeal } from '../src/lib/itinerary-plan'
import { optimizeRoute } from '../src/lib/route-optimizer'

// Meals: recognised, kept at their time by Suggest route, and not suggested again by Check day.
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const BASE = { lat: 35.697999, lng: 139.770830 }
const DARUMANOME = { _id: 'darumanome', shopName: 'Darumanome Akihabara', placeType: 'restaurant', latitude: 35.6995, longitude: 139.7715, openingHours: '11:00-22:00' }
const shopById = new Map<string, any>([[DARUMANOME._id, DARUMANOME]])

test.describe('meals', () => {
  test('a meal: a restaurant, or "mat", "lunsj", "lunch", "middag", "dinner", "frokost", "breakfast" in its tag or note — whole words, any case', () => {
    expect(isMealStop({ placeType: 'restaurant' })).toBe(true)
    expect(isMealStop({ tag: 'mat' })).toBe(true)
    expect(isMealStop({ tag: 'MAT' })).toBe(true)
    expect(isMealStop({ note: 'Lunsj her før Shinjuku' })).toBe(true)
    expect(isMealStop({ note: 'Breakfast at the hotel' })).toBe(true)
    expect(isMealStop({ note: 'quick dinner' })).toBe(true)
    expect(isMealStop({ note: 'Frokost' })).toBe(true)
    expect(isMealStop({ note: 'Middag kl 19' })).toBe(true)
    expect(isMealStop({ placeType: 'shop', tag: 'MUST', note: 'Matsuya figures, the format matters' })).toBe(false) // not inside other words
    expect(isMealStop({})).toBe(false)
    expect(stopIsMeal({ name: 'x', shopId: 'darumanome' }, shopById)).toBe(true)
  })

  test('Check day gets each stop\'s place type, tag and own note; the prompt marks the meal', () => {
    const day: any = { day: '2026-12-02', date: '', area: '', note: '', startTime: '10:00', stops: [
      { name: 'Super Potato', lat: 35.699358, lng: 139.770702, dur: 60, tag: 'MUST' },
      { name: 'x', shopId: 'darumanome', dur: 45, note: 'ramen' },
    ] }
    const body = checkDayRequestBody(day, { base: BASE, shopById, flight: null })
    expect(body.stops[0]).toMatchObject({ placeType: null, tag: 'MUST', ownNote: null })
    expect(body.stops[1]).toMatchObject({ name: 'Darumanome Akihabara', placeType: 'restaurant', tag: null, ownNote: 'ramen' })
    const prompt = buildUserPrompt('Wednesday 2 December 2026', null, '10:00',
      [{ name: 'Super Potato', plannedTime: t('10:00'), durationMin: 60, lat: null, lng: null }, { name: 'Darumanome Akihabara', plannedTime: t('13:27'), durationMin: 45, lat: null, lng: null, meal: true }],
      [null, null], [null, null])
    expect(prompt).toContain("MEAL (already the day's meal here — don't suggest adding one around this time)")
    expect(prompt.split('MEAL (').length).toBe(2) // only on the lunch
  })

  test('the real case: lunch at Darumanome Akihabara at 13:27 (stop 5) — a suggestion to add Darumanome is dropped by the server', () => {
    const ctx = {
      stops: ['Super Potato', 'Animate', 'AKIHABARA KOTOBUKIYA', 'Liberty Akihabara 5', 'Darumanome Akihabara', 'Liberty Hobby Shop']
        .map((name, i) => ({ name, plannedTime: t('10:00') + i * 60, durationMin: 45 })),
      dayDate: '2026-12-02', tripDays: ['2026-12-02'],
    }
    const items = modelReviewItems([
      { severity: 'tip', stopIndex: null, message: 'No lunch break in a long day.', suggestion: 'Add a lunch stop at Darumanome for ramen around 13:00.' },
      { severity: 'tip', stopIndex: 4, message: 'Darumanome Akihabara gets busy at noon.', suggestion: 'Arrive a little earlier.' },
      { severity: 'tip', stopIndex: null, message: 'A long day.', suggestion: 'Add a coffee break somewhere.' },
    ], ctx, 8)
    expect(items.map((i) => i.message)).toEqual(['Darumanome Akihabara gets busy at noon.', 'A long day.'])
    expect(suggestsAddingExisting('Visit Super Potato again later', ctx.stops.map((s) => s.name))).toBe(true)
    expect(suggestsAddingExisting('Add a stop in Akihabara', ctx.stops.map((s) => s.name))).toBe(false) // an area isn't a stop
  })

  test('Suggest route keeps the lunch at its time (±15 min) and plans the others around it', () => {
    const shop = (k: number, name: string) => ({ name, lat: 35.698 + k * 0.0012, lng: 139.770 + (k % 2) * 0.0015, dur: 60, hours: '10:00-20:00' })
    // Five shops, the lunch fifth (13:27 in the current plan), badly ordered for walking.
    const day: any = { day: '2026-12-02', date: '', area: '', note: '', startTime: '09:20', stops: [
      shop(4, 'Far A'), shop(0, 'Near B'), shop(3, 'Far C'), shop(1, 'Near D'),
      { name: 'x', shopId: 'darumanome', dur: 45 },
      shop(2, 'Mid E'),
    ] }
    const input = optimizerInput(day, { base: BASE, shopById })
    const lunchNow = input.stops[4].mealWindow!
    expect(lunchNow.to - lunchNow.from).toBe(30)
    const now = (lunchNow.from + lunchNow.to) / 2
    const r = optimizeRoute(input.stops, input.startTime!, input.start, input.weekday, input.date)
    const pos = r.order.indexOf(4)
    expect(Math.abs(r.suggested.times[pos] - now)).toBeLessThanOrEqual(15)
    // Many stops too (the heuristic): the same.
    const big: any = { ...day, stops: [...day.stops, shop(5, 'Extra F'), shop(6, 'Extra G')] }
    const bigIn = optimizerInput(big, { base: BASE, shopById })
    const bigNow = (bigIn.stops[4].mealWindow!.from + bigIn.stops[4].mealWindow!.to) / 2
    const r2 = optimizeRoute(bigIn.stops, bigIn.startTime!, bigIn.start, bigIn.weekday, bigIn.date)
    expect(Math.abs(r2.suggested.times[r2.order.indexOf(4)] - bigNow)).toBeLessThanOrEqual(15)
  })
})
