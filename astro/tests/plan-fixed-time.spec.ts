import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { setFixedTime, computeDayTimes, resolveStop, type PlanDay } from '../src/lib/itinerary-plan'

// Changing a fixed time (itinerary-plan.ts setFixedTime) on the real 1 December 2026 day: on
// 18 Nov the cafe's time change re-sorted the whole day — the cafe first, every shop after it,
// past midnight, the day starting 00:07 (tests/plan-samples/dec1-2026.json, from Sanity's history:
// before = the last good revision, broken = the save right after).
const SAMPLE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'plan-samples', 'dec1-2026.json'), 'utf8'))
const AKIBA = { lat: 35.698, lng: 139.7731 }
const t = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const names: Record<string, string> = SAMPLE.shopNames
const nameOf = (s: any) => (s.shopId && names[s.shopId]) || s.name
const SHOPS = new Map<string, any>(Object.entries(names).map(([id, shopName]) => [id, { _id: id, shopName }]))
const freshDay = (): PlanDay => ({ day: '2026-12-01', date: '1. des (tir)', area: 'Akihabara', note: '', startTime: SAMPLE.before.startTime, stops: JSON.parse(JSON.stringify(SAMPLE.before.stops)) } as any)
const cafeIndex = (day: PlanDay) => day.stops.findIndex((s) => /eorzea/i.test(nameOf(s)))

test.describe('a fixed-time change on the real 1 December day', () => {
  test('the broken save is what the old re-sort did: the cafe first, Don Quijote third, the start 00:07', () => {
    expect(SAMPLE.broken.startTime).toBe('00:07')
    expect(nameOf(SAMPLE.broken.stops[0])).toMatch(/Eorzea/)
    expect(SAMPLE.before.stops.map(nameOf).indexOf('Final Fantasy Eorzea Cafe')).toBe(13)
  })

  test('the phone picker passing 00:45, then 19:00, then 19:45: the day keeps its order and its start', () => {
    const day = freshDay()
    const before = day.stops.map(nameOf)
    const idx = cafeIndex(day)
    // 00:45 (scrolling through the picker): before the day starts — can't fit: not applied, nothing moves.
    let r = setFixedTime(day, idx, '00:45', AKIBA, SHOPS)
    expect(r.moved).toBe(false)
    expect(r.warning).toBe('00:45 is before the day starts (08:45) — Final Fantasy Eorzea Cafe keeps its 20:00 and stays where it is. Change the day\'s start if that\'s what you meant.')
    expect(day.stops[idx].fixedTime).toBe('20:00') // not applied
    expect(day.stops.map(nameOf)).toEqual(before)
    expect(day.startTime).toBe('08:45')
    // 19:00, then 19:45 (arrive 15 early): still after every shop planned before it; the day never
    // looks like the broken save, and its start stays 08:45.
    for (const time of ['19:00', '19:45']) {
      r = setFixedTime(day, cafeIndex(day), time, AKIBA, SHOPS)
      expect(r.warning).toBeNull()
      expect(day.startTime).toBe('08:45')
      const order = day.stops.map(nameOf)
      expect(order).not.toEqual(SAMPLE.broken.stops.map(nameOf))
      expect(order[0]).toMatch(/Anshin Oyado/)
      expect(order[order.length - 1]).toBe('Don Quijote Akihabara')
      // Every stop planned before the new time is still before the cafe.
      const { times } = computeDayTimes(day, AKIBA, SHOPS)
      const c = cafeIndex(day)
      day.stops.forEach((_, i) => { if (i < c) expect(times[i]).toBeLessThanOrEqual(t(time)) })
    }
    expect(day.stops[cafeIndex(day)].fixedTime).toBe('19:45')
  })
})

test.describe('setFixedTime: only that stop moves', () => {
  const stop = (name: string, extra: Record<string, unknown> = {}) => ({ name, hours: '', tag: '', slot: '', lat: 35.7, lng: 139.77, dur: 60, travelMin: 0, travelFrom: '__base__', ...extra })
  const day = (): PlanDay => ({ day: '2026-12-05', date: '', area: '', note: '', startTime: '10:00', stops: [stop('A'), stop('B'), stop('C'), stop('D')] } as any)

  test('to after every stop planned at or before its time; the others keep their order; unpinning moves nothing', () => {
    let d = day() // A 10:00, B 11:00, C 12:00, D 13:00
    expect(setFixedTime(d, 3, '11:30', AKIBA, new Map())).toEqual({ moved: true, warning: null })
    expect(d.stops.map((s) => s.name)).toEqual(['A', 'B', 'D', 'C'])
    d = day()
    expect(setFixedTime(d, 0, '12:30', AKIBA, new Map()).moved).toBe(true)
    expect(d.stops.map((s) => s.name)).toEqual(['B', 'C', 'A', 'D']) // B, C were planned (before the change) by 12:30
    d = day()
    expect(setFixedTime(d, 1, '11:00', AKIBA, new Map()).moved).toBe(false) // already its place
    expect(setFixedTime(d, 1, '', AKIBA, new Map())).toEqual({ moved: false, warning: null })
    expect(d.stops.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D'])
    expect(d.startTime).toBe('10:00')
    expect(resolveStop(d.stops[1], new Map()).name).toBe('B')
  })
})
