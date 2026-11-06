import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import {
  planDocIdFor, planSaveDoc, planStoreKey, ownsOriginalPlan, planTrips, arrivalFor, shopsTripFirst, countdownTrips, nextCountdown,
  ORIGINAL_PLAN_DOC_ID, withFlightDays,
} from '../src/lib/trip-plans'
import { buildPlanState, shopOptionGroups, TRIP_SHOPS_GROUP } from '../src/lib/itinerary-plan'

// Several trips, each with its own plan (lib/trip-plans.ts). The December 2026 trip keeps the
// original `itineraryState` document, read and written exactly as before; never written here —
// its saves are answered by a mock. Other trips' plans are their own documents, created by the
// test and deleted after it.
const DEC = { _id: 'dec-trip', firstTokyoDay: '2026-12-01', lastTokyoDay: '2026-12-06' }
const FEB = { _id: 'feb-trip', firstTokyoDay: '2027-02-21', lastTokyoDay: '2027-03-05' }

test.describe('trip plans (lib/trip-plans.ts)', () => {
  test('the December 2026 trip, no trip, and a trip without Tokyo days keep the original document; another trip gets its own', () => {
    expect(planDocIdFor(DEC)).toBe('itineraryState')
    expect(planDocIdFor({ ...DEC, lastTokyoDay: '2026-12-07' })).toBe('itineraryState') // still December
    expect(planDocIdFor(null)).toBe('itineraryState')
    expect(planDocIdFor({ _id: 'x', firstTokyoDay: null, lastTokyoDay: null })).toBe('itineraryState')
    expect(planDocIdFor(FEB)).toBe('itineraryState-feb-trip')
    expect(ownsOriginalPlan(FEB)).toBe(false)
    expect(planDocIdFor({ ...FEB, _id: 'drafts.feb-trip' })).toBe('itineraryState') // never a path id
  })

  test('the saved document: the original exactly as before (_id, _type, data, updatedAt); another trip\'s with its trip', () => {
    const now = new Date('2026-11-06T12:00:00Z')
    expect(planSaveDoc(DEC as any, '{"v":2}', now)).toEqual({ _id: 'itineraryState', _type: 'itineraryState', data: '{"v":2}', updatedAt: '2026-11-06T12:00:00.000Z' })
    expect(planSaveDoc(null, '{"v":2}', now)).toEqual({ _id: 'itineraryState', _type: 'itineraryState', data: '{"v":2}', updatedAt: '2026-11-06T12:00:00.000Z' })
    expect(planSaveDoc(FEB as any, '{"v":2}', now)).toEqual({
      _id: 'itineraryState-feb-trip', _type: 'itineraryState', data: '{"v":2}', updatedAt: '2026-11-06T12:00:00.000Z',
      trip: { _type: 'reference', _ref: 'feb-trip', _weak: true },
    })
    expect(planStoreKey('ff-itinerary-v12', DEC)).toBe('ff-itinerary-v12')
    expect(planStoreKey('ff-itinerary-v12', FEB)).toBe('ff-itinerary-v12:itineraryState-feb-trip')
    expect(planTrips([FEB, { _id: 'none' }, DEC] as any).map((t) => t._id)).toEqual(['dec-trip', 'feb-trip'])
  })

  test('the days in Tokyo entered once: empty ones come from the flight dates; filled-in ones are kept', () => {
    expect(withFlightDays({ _id: 'x', arrivalDate: '2027-02-21', flightHomeDate: '2027-03-05' })).toMatchObject({ firstTokyoDay: '2027-02-21', lastTokyoDay: '2027-03-05' })
    expect(withFlightDays({ ...DEC, arrivalDate: '2026-11-30', flightHomeDate: '2026-12-07' })).toMatchObject({ firstTokyoDay: '2026-12-01', lastTokyoDay: '2026-12-06' })
    expect(withFlightDays({ _id: 'x', arrivalDate: '2027-02-21' })).toMatchObject({ firstTokyoDay: '2027-02-21', lastTokyoDay: null })
    expect(planDocIdFor(withFlightDays({ _id: 'feb', arrivalDate: '2027-02-21', flightHomeDate: '2027-03-05' }))).toBe('itineraryState-feb')
  })

  test('the arrival: landing + 90 min + the airport to the base (Haneda 40, Narita 75); its date defaults to the first day in Tokyo', () => {
    expect(arrivalFor({ ...FEB, arrivalDate: '2027-02-21', arrivalTime: '07:55', arrivalAirport: 'Haneda' })).toEqual({
      date: '2027-02-21', time: '07:55', airport: 'Haneda', airportName: 'Haneda Airport', start: '10:05',
      line: '✈️ Landing 07:55 at Haneda Airport',
    })
    expect(arrivalFor({ ...FEB, arrivalTime: '07:55', arrivalAirport: 'Narita' })).toMatchObject({ date: '2027-02-21', start: '10:40' })
    expect(arrivalFor({ ...FEB, arrivalTime: '7:55', arrivalAirport: 'Haneda' })).toBeNull()
    expect(arrivalFor({ ...FEB, arrivalTime: '07:55' })).toBeNull()
    expect(arrivalFor(DEC)).toBeNull()
  })

  test('the arrival day starts after landing unless a start was chosen; other days as before', () => {
    const labels = { '2027-02-21': '21. feb', '2027-02-22': '22. feb' }
    const defaults = { '2027-02-21': '10:05' }
    let { state } = buildPlanState([], ['2027-02-21', '2027-02-22'], labels, {}, defaults)
    expect(state.map((d) => d.startTime)).toEqual(['10:05', '08:00'])
    // Every save writes every day's start: a saved 08:00 (the default) isn't a choice …
    ;({ state } = buildPlanState([], ['2027-02-21', '2027-02-22'], labels, { '2027-02-21': { startTime: '08:00', stops: [] } }, defaults))
    expect(state[0].startTime).toBe('10:05')
    // … any other time is.
    ;({ state } = buildPlanState([], ['2027-02-21'], labels, { '2027-02-21': { startTime: '11:30', stops: [] } }, defaults))
    expect(state[0].startTime).toBe('11:30')
  })

  test('shops: the trip\'s first (in their own group in the picker), then the rest; nothing removed', () => {
    const shops = [
      { shopName: 'A', area: 'Akihabara', tripIds: [] },
      { shopName: 'B', area: 'Shinjuku', tripIds: ['feb-trip'] },
      { shopName: 'C', area: 'Akihabara', tripIds: ['feb-trip', 'dec-trip'] },
      { shopName: 'D', area: 'Nakano' },
    ]
    expect(shopsTripFirst(shops, 'feb-trip').map((s) => s.shopName)).toEqual(['B', 'C', 'A', 'D'])
    expect(shopsTripFirst(shops, null).map((s) => s.shopName)).toEqual(['A', 'B', 'C', 'D'])
    const groups = shopOptionGroups(shops, 'feb-trip')
    expect(groups.map((g) => [g.area, g.items.map((i) => i.name)])).toEqual([[TRIP_SHOPS_GROUP, ['B', 'C']], ['Akihabara', ['A']], ['Nakano', ['D']]])
    expect(shopOptionGroups(shops).map((g) => g.area)).toEqual(['Akihabara', 'Nakano', 'Shinjuku'])
  })

  test('the countdown: each trip with both flights, in Japan time; the first whose flight home is still ahead', () => {
    const trips = countdownTrips([
      { ...FEB, label: 'Feb', arrivalTime: '07:55', flightHomeDate: '2027-03-05', flightHomeTime: '09:55' },
      { ...DEC, label: 'No times' },
      { _id: 'jan', label: 'Jan', firstTokyoDay: '2027-01-10', lastTokyoDay: '2027-01-12', arrivalTime: '06:00', flightHomeTime: '22:00' },
    ])
    expect(trips).toEqual([
      { label: 'Jan', arrive: '2027-01-10T06:00:00+09:00', leave: '2027-01-12T22:00:00+09:00' },
      { label: 'Feb', arrive: '2027-02-21T07:55:00+09:00', leave: '2027-03-05T09:55:00+09:00' },
    ])
    expect(nextCountdown(trips, new Date('2027-01-11T00:00:00Z'))?.label).toBe('Jan')
    expect(nextCountdown(trips, new Date('2027-01-13T00:00:00Z'))?.label).toBe('Feb')
    expect(nextCountdown(trips, new Date('2027-04-01T00:00:00Z'))).toBeNull()
  })
})

// --- On the pages ----------------------------------------------------------------------------
async function makeTrip(sanity: any, trackDoc: (id: string) => void, name: string, fields: Record<string, unknown>) {
  const trip = await sanity.create({ _type: 'tripSettings', label: testName(`${name} ${Date.now()}`), ...fields })
  trackDoc(trip._id)
  return trip
}
// Saves answered by a mock (and recorded): the shared plan is never written.
async function mockSaves(page: Page) {
  const saves: any[] = []
  await page.route('**/api/itinerary-save', async (route) => {
    saves.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  return saves
}
const pageData = (page: Page) => page.evaluate(() => JSON.parse(document.querySelector('#itl-data')!.textContent || '{}'))

test.describe('/itinerary with several trips', () => {
  test('the December 2026 trip: its plan read from the original document, saved with its trip, kept under the old browser key', async ({ page, sanity, trackDoc }) => {
    const trip = await makeTrip(sanity, trackDoc, 'December Plan Trip', { firstTokyoDay: '2026-12-01', lastTokyoDay: '2026-12-06' })
    const original = await sanity.fetch(`*[_id == "itineraryState"][0]{ data, updatedAt }`)
    const saves = await mockSaves(page)
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    const data = await pageData(page)
    expect(data.savedState).toBe(original ? original.data : null) // the original document's plan
    expect(data.storeKey).toBe('ff-itinerary-v12')
    // A change is saved as before: the whole plan, with the trip (the server maps it to the
    // original document — planSaveDoc above); here answered by the mock.
    await page.locator('#itl-start').fill('08:15')
    await page.locator('#itl-start').dispatchEvent('change')
    await expect.poll(() => saves.length, { timeout: 10000 }).toBeGreaterThan(0)
    expect(saves[saves.length - 1].tripId).toBe(trip._id)
    expect(JSON.parse(saves[saves.length - 1].data)).toMatchObject({ v: 2 })
    expect(await page.evaluate(() => typeof localStorage.getItem('ff-itinerary-v12'))).toBe('string')
    // The original document is untouched.
    expect(await sanity.fetch(`*[_id == "itineraryState"][0]{ data, updatedAt }`)).toEqual(original)
  })

  test('another trip gets its own plan document on its first save, read back by its pages; the original is untouched', async ({ page, sanity, trackDoc }) => {
    const trip = await makeTrip(sanity, trackDoc, 'Own Plan Trip', { firstTokyoDay: '2027-02-21', lastTokyoDay: '2027-02-23' })
    const docId = `itineraryState-${trip._id}`
    trackDoc(docId)
    const original = await sanity.fetch(`*[_id == "itineraryState"][0]{ data, updatedAt }`)
    // Before any save: nothing (no December default stops either).
    await page.goto(`/itinerary?trip=${trip._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    let data = await pageData(page)
    expect(data.savedState).toBeNull()
    expect(data.plan).toEqual([])
    expect(data.storeKey).toBe(`ff-itinerary-v12:${docId}`)
    await expect(page.locator('.itl-tab')).toHaveText(['21. feb (søn)', '22. feb (man)', '23. feb (tir)'])

    // The real endpoint, for this trip.
    const plan = { v: 2, days: { '2027-02-22': { startTime: '09:00', stops: [{ name: 'Own Plan Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 45 }] } } }
    const res = await page.request.post('/api/itinerary-save', { data: { data: JSON.stringify(plan), tripId: trip._id } })
    expect(res.status()).toBe(200)
    const saved = await sanity.getDocument(docId)
    expect(saved).toMatchObject({ _type: 'itineraryState', data: JSON.stringify(plan), trip: { _ref: trip._id, _weak: true } })
    expect(await sanity.fetch(`*[_id == "itineraryState"][0]{ data, updatedAt }`)).toEqual(original)

    // Read back on both pages.
    await page.goto(`/itinerary?trip=${trip._id}&day=2027-02-22`)
    await expect(page.locator('.itl-block .itl-name', { hasText: 'Own Plan Stop' })).toBeVisible()
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').nth(1)).toContainText('Own Plan Stop')
    // An unknown trip is refused, and nothing is written.
    const bad = await page.request.post('/api/itinerary-save', { data: { data: '{"v":2,"days":{}}', tripId: 'no-such-trip-123' } })
    expect(bad.status()).toBe(400)
    expect(await sanity.fetch(`*[_id == "itineraryState"][0]{ data, updatedAt }`)).toEqual(original)
  })

  test('the trip switcher: every trip with Tokyo days; switching opens its days; remembered when opened without ?trip=; the list too', async ({ page, sanity, trackDoc }) => {
    const a = await makeTrip(sanity, trackDoc, 'Switch A', { firstTokyoDay: '2027-02-21', lastTokyoDay: '2027-02-22' })
    const b = await makeTrip(sanity, trackDoc, 'Switch B', { firstTokyoDay: '2027-03-10', lastTokyoDay: '2027-03-11' })
    await mockSaves(page)
    await page.goto(`/itinerary?trip=${a._id}`)
    const sw = page.locator('#trip-switch')
    await expect(sw).toHaveValue(a._id)
    await expect(sw.locator(`option[value="${b._id}"]`)).toHaveText(`${b.label} · 10. mar (ons) – 11. mar (tor)`)
    await sw.selectOption(b._id)
    await expect(page).toHaveURL(new RegExp(`[?&]trip=${b._id}`))
    await expect(page.locator('.itl-tab')).toHaveText(['10. mar (ons)', '11. mar (tor)'])
    // Opened without ?trip=: back to B.
    await page.goto('/itinerary')
    await expect(page).toHaveURL(new RegExp(`[?&]trip=${b._id}`))
    await expect(page.locator('#trip-switch')).toHaveValue(b._id)
    await page.goto('/itinerary-list')
    await expect(page).toHaveURL(new RegExp(`/itinerary-list\\?trip=${b._id}`))
    await page.locator('#trip-switch').selectOption(a._id)
    await expect(page).toHaveURL(new RegExp(`/itinerary-list\\?trip=${a._id}`))
    await expect(page.locator('.day-card')).toHaveCount(2)
  })

  test('the arrival flight: "✈️ Landing 07:55 at Haneda Airport" on the first day, which starts at 10:05; the next day at 08:00', async ({ page, sanity, trackDoc }) => {
    const trip = await makeTrip(sanity, trackDoc, 'Arrival Trip', {
      firstTokyoDay: '2027-02-21', lastTokyoDay: '2027-02-22', arrivalDate: '2027-02-21', arrivalTime: '07:55', arrivalAirport: 'Haneda',
    })
    await mockSaves(page)
    await page.goto(`/itinerary?trip=${trip._id}&day=2027-02-21`)
    await expect(page.locator('#itl-arrival')).toHaveText('✈️ Landing 07:55 at Haneda Airport')
    await expect(page.locator('#itl-start')).toHaveValue('10:05')
    await page.locator('.itl-tab', { hasText: '22. feb' }).click()
    await expect(page.locator('#itl-arrival')).toBeHidden()
    await expect(page.locator('#itl-start')).toHaveValue('08:00')
    await page.goto(`/itinerary-list?trip=${trip._id}`)
    await expect(page.locator('.day-card').first().locator('.day-arrival')).toHaveText('✈️ Landing 07:55 at Haneda Airport')
    await expect(page.locator('.day-start-input').first()).toHaveValue('10:05')
    await expect(page.locator('.day-card').nth(1).locator('.day-arrival')).toHaveCount(0)
  })

  test('shops for the trip first: in the timeline\'s picker ("🧳 This trip") and on the shop list', async ({ page, sanity, trackDoc }) => {
    const trip = await makeTrip(sanity, trackDoc, 'Shops Trip', { firstTokyoDay: '2027-02-21', lastTokyoDay: '2027-02-22' })
    const shop = await sanity.create({
      _type: 'shopNote', shopName: testName(`Zz Trip Shop ${Date.now()}`), area: 'Zzz Last Area', latitude: 35.7, longitude: 139.77,
      trips: [{ _type: 'reference', _ref: trip._id, _key: trip._id }],
    })
    trackDoc(shop._id)
    await mockSaves(page)
    await page.goto(`/itinerary?trip=${trip._id}`)
    const first = page.locator('#itl-add-shop optgroup').first()
    await expect(first).toHaveAttribute('label', '🧳 This trip')
    await expect(first.locator('option')).toHaveText([shop.shopName])
    // The shop list: the remembered trip's shops first (the itinerary's switcher remembers it).
    await page.goto('/notes')
    // First on screen (CSS order: the cards themselves stay where they are).
    await expect(page.locator('#notes-trip-first')).toBeVisible()
    const topName = await page.locator('.note-card').evaluateAll((cards) => {
      const shown = cards.filter((c) => (c as HTMLElement).offsetParent !== null)
      shown.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      return shown[0]?.querySelector('.note-name')?.textContent
    })
    expect(topName).toBe(shop.shopName)
    await expect(page.locator('#notes-trip-first')).toHaveText(`🧳 ${trip.label}: its shops first (1), then the rest.`)
    // Only reordered: the rest are still there (the "All trips" filter is untouched).
    await expect(page.locator('#trip-filter')).toHaveValue('')
    expect(await page.locator('.note-card').count()).toBeGreaterThan(1)
  })
})
