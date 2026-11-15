import type { Page } from '@playwright/test'
import { test, expect, testName } from './fixtures'
import { plannedDaysByShop, savedPlanDays, plannedDaysText, plannedPickerName, matchingShop } from '../src/lib/plan-usage'
import { shopOptionGroups } from '../src/lib/itinerary-plan'
import { planDocIdFor } from '../src/lib/trip-plans'

// Which places are already in a trip's plan (lib/plan-usage.ts): the itinerary's shop pickers and
// Shop Notes read the trip's saved plan with the same helper.
test.describe('places in the plan (lib/plan-usage.ts)', () => {
  test('a place\'s days from the saved plan, only the trip\'s days; both date styles; the picker label', () => {
    const data = JSON.stringify({ v: 2, days: {
      '2027-03-02': { stops: [{ name: 'Animate', shopId: 'A' }, { name: 'Hand-written' }] },
      '2027-03-05': { stops: [{ name: 'Animate', shopId: 'A' }, { name: 'Don Quijote', shopId: 'D' }] },
      '2027-03-04': { stops: [{ name: 'Animate again', shopId: 'A' }] },
      '2027-04-01': { stops: [{ name: 'Outside the trip', shopId: 'O' }] },
    } })
    const days = savedPlanDays(data, { first: '2027-03-01', last: '2027-03-05' })
    expect(plannedDaysByShop(days)).toEqual({ A: ['2027-03-02', '2027-03-04', '2027-03-05'], D: ['2027-03-05'] })
    expect(savedPlanDays('not json')).toEqual([])
    expect(savedPlanDays(JSON.stringify([{ stops: [] }]))).toEqual([])
    expect(plannedDaysText(['2026-12-02', '2026-12-05'], 'nb')).toBe('2. des, 5. des')
    expect(plannedDaysText(['2026-12-02', '2026-12-05'], 'en')).toBe('2 Dec, 5 Dec')
    expect(plannedPickerName('Animate', ['2026-12-02'])).toBe('✓ Animate · 2. des')
    expect(plannedPickerName('Animate', [])).toBe('Animate')
  })

  test('the pickers: ✓ and the days, same areas and order; a search result matching a saved place', () => {
    const shops = [
      { _id: 'D', shopName: 'Don Quijote Akihabara', area: 'Akihabara' },
      { _id: 'A', shopName: 'Animate', area: 'Akihabara' },
      { _id: 'M', shopName: 'Mandarake', area: 'Nakano' },
    ]
    const groups = shopOptionGroups(shops, null, { A: ['2026-12-02'], D: ['2026-12-02', '2026-12-05'] })
    expect(groups.map((g) => [g.area, g.items.map((i) => i.name)])).toEqual([
      ['Akihabara', ['✓ Animate · 2. des', '✓ Don Quijote Akihabara · 2. des, 5. des']],
      ['Nakano', ['Mandarake']],
    ])
    expect(matchingShop({ name: 'Animate', lat: 35.7, lng: 139.77 }, shops)?._id).toBe('A')
    expect(matchingShop({ name: 'Somewhere Else', lat: 35.7, lng: 139.77 }, shops)).toBeNull()
  })
})

// Two test trips in 2027 (each with its own plan document) and three places.
async function setup(sanity: any, trackDoc: (id: string) => void, tick = false) {
  const tag = Date.now()
  const shop = async (name: string) => {
    const d = await sanity.create({ _type: 'shopNote', shopName: testName(`${name} ${tag}`), area: `Plan Area ${tag}`, latitude: 35.7, longitude: 139.77 })
    trackDoc(d._id)
    return d
  }
  const one = await shop('Planned Once')
  const two = await shop('Planned Twice')
  const none = await shop('Not Planned')
  const trip = async (label: string, first: string, last: string, days: Record<string, string[]>) => {
    const t = await sanity.create({ _type: 'tripSettings', label: testName(`${label} ${tag}`), firstTokyoDay: first, lastTokyoDay: last })
    trackDoc(t._id)
    const data = JSON.stringify({ v: 2, days: Object.fromEntries(Object.entries(days).map(([day, ids]) => [day, { startTime: '10:00', stops: ids.map((id) => ({ name: 'x', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, shopId: id })) }])) })
    const doc = await sanity.createOrReplace({ _id: planDocIdFor({ ...t }), _type: 'itineraryState', data, updatedAt: new Date().toISOString(), trip: { _type: 'reference', _ref: t._id, _weak: true } })
    trackDoc(doc._id)
    return t
  }
  const march = await trip('March Trip', '2027-03-01', '2027-03-05', { '2027-03-02': [one._id, two._id], '2027-03-05': [two._id] })
  const april = await trip('April Trip', '2027-04-01', '2027-04-03', { '2027-04-02': [none._id] })
  // Ticked for both trips on the shop page (Shop Notes' trip filter shows a trip's ticked places).
  if (tick) for (const s of [one, two, none]) await sanity.patch(s._id).set({ trips: [march, april].map((t) => ({ _type: 'reference', _ref: t._id, _key: t._id, _weak: true })) }).commit()
  return { tag, one, two, none, march, april }
}

test.describe('/itinerary: places already in the plan in the pickers', () => {
  test('add stop, link to shop and search: "✓ name · days" for a place on one and on two days, none for an unplanned one', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(90_000)
    const { one, two, none, march, april } = await setup(sanity, trackDoc)
    await page.route('**/api/itinerary-save', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await page.goto(`/itinerary?trip=${march._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    const options = async (sel: string) => page.locator(`${sel} option`).allTextContents()
    let names = await options('#itl-add-shop')
    expect(names).toContain(`✓ ${one.shopName} · 2. mar`)
    expect(names).toContain(`✓ ${two.shopName} · 2. mar, 5. mar`)
    expect(names).toContain(none.shopName)
    // Still in their area, A–Z by the name itself.
    const area = page.locator('#itl-add-shop optgroup').filter({ has: page.locator('option', { hasText: one.shopName }) })
    expect(await area.locator('option').allTextContents()).toEqual([none.shopName, `✓ ${one.shopName} · 2. mar`, `✓ ${two.shopName} · 2. mar, 5. mar`])
    // Picking one is still allowed: on another day it's added.
    await page.locator('.itl-tab', { hasText: '3. mar' }).click()
    const grid = page.locator('.itl-grid')
    const start = Number(await grid.getAttribute('data-start'))
    await grid.click({ position: { x: 3, y: Math.round((11 * 60 - start) * Number(await grid.getAttribute('data-px'))) + 2 } })
    await expect(page.locator('#itl-add')).toBeVisible()
    await page.locator('#itl-add-shop').selectOption({ label: `✓ ${one.shopName} · 2. mar` })
    await page.locator('#itl-add-save').click()
    // Opened again: the new day is in its label.
    await grid.click({ position: { x: 3, y: Math.round((15 * 60 - start) * Number(await grid.getAttribute('data-px'))) + 2 } })
    names = await options('#itl-add-shop')
    expect(names).toContain(`✓ ${one.shopName} · 2. mar, 3. mar`)
    await page.locator('#itl-add-cancel').click()

    // "🔗 Link to shop" on a hand-written stop: the same labels.
    await page.evaluate(() => {
      // @ts-ignore - the page's test hook
      const itl = window.__itl; const d = itl.state.find((x: any) => x.day === '2027-03-03')
      d.stops.push({ name: 'Hand Written Stop', hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 30 }); itl.render()
    })
    await page.locator('.itl-block').filter({ has: page.locator('.itl-name', { hasText: 'Hand Written Stop' }) }).locator('.itl-name').click()
    await expect(page.locator('#itl-ed-link')).toBeVisible()
    const linkNames = await options('#itl-ed-link-shop')
    expect(linkNames).toContain(`✓ ${two.shopName} · 2. mar, 5. mar`)
    expect(linkNames).toContain(`✓ ${one.shopName} · 2. mar, 3. mar`)
    expect(linkNames).toContain(none.shopName)
    await page.locator('#itl-detail-close').click()

    // "🔍 Search place": a result that is a saved place in the plan says so.
    await page.route('**/api/place-search?*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, attribution: '', results: [
      { name: two.shopName, address: 'Akihabara', lat: 35.7, lng: 139.77, kind: 'shop', placeType: 'shop', area: null, openingHours: null, osmId: 'n1' },
      { name: 'Unknown Place', address: 'Akihabara', lat: 35.7, lng: 139.77, kind: 'shop', placeType: 'shop', area: null, openingHours: null, osmId: 'n2' },
    ] }) }))
    await grid.click({ position: { x: 3, y: Math.round((16 * 60 - start) * Number(await grid.getAttribute('data-px'))) + 2 } })
    await page.locator('#itl-add-search-btn').click()
    await page.locator('#itl-add-search-q').fill('anything')
    const results = page.locator('#itl-add-search-results .ps-result')
    await expect(results).toHaveCount(2)
    await expect(results.nth(0).locator('.ps-note')).toHaveText(`✓ ${two.shopName} · 2. mar, 5. mar`)
    await expect(results.nth(1).locator('.ps-note')).toHaveCount(0)

    // Another trip: its own plan.
    await page.goto(`/itinerary?trip=${april._id}`)
    await expect(page.locator('.itl-grid')).toBeVisible()
    names = await options('#itl-add-shop')
    expect(names).toContain(`✓ ${none.shopName} · 2. apr`)
    expect(names).toContain(one.shopName)
  })
})

test.describe('/notes: "📅 Planned" for the selected trip', () => {
  test('the badge and the Planned / Not planned filter; switching trip changes them', async ({ page, sanity, trackDoc }) => {
    test.setTimeout(60_000)
    const { tag, one, two, none, march, april } = await setup(sanity, trackDoc, true)
    await page.goto(`/notes?trip=${march._id}`)
    await page.locator('#search-input').fill(String(tag))
    const card = (name: string) => page.locator('.note-card').filter({ has: page.locator('.note-name', { hasText: name }) })
    const badge = (name: string) => card(name).locator('.planned-badge')
    // ?trip= picks the trip for the badges (no trip chosen in the filter).
    await expect(badge(one.shopName)).toHaveText('📅 Planned: 2 Mar')
    await expect(badge(two.shopName)).toHaveText('📅 Planned: 2 Mar, 5 Mar')
    await expect(badge(none.shopName)).toBeHidden()
    const shown = () => page.locator('.note-card:visible .note-name')
    await page.locator('#planned-filter').selectOption('planned')
    await expect(shown()).toHaveText([one.shopName, two.shopName])
    await page.locator('#planned-filter').selectOption('unplanned')
    await expect(shown()).toHaveText([none.shopName])
    // Switching to the April trip in the trip filter: its plan has only the third place.
    await page.locator('#planned-filter').selectOption('')
    await page.locator('#trip-filter').selectOption(april._id)
    await expect(badge(none.shopName)).toHaveText('📅 Planned: 2 Apr')
    await expect(badge(one.shopName)).toBeHidden()
    await page.locator('#planned-filter').selectOption('planned')
    await expect(shown()).toHaveText([none.shopName])
    // And back to the March trip.
    await page.locator('#trip-filter').selectOption(march._id)
    await expect(shown()).toHaveText([one.shopName, two.shopName])
    await expect(badge(two.shopName)).toHaveText('📅 Planned: 2 Mar, 5 Mar')
  })
})
