// Layout for /itinerary-timeline: where each stop and each trip between stops sits on a day's
// vertical time axis. Pure arithmetic over the shared timetable (itinerary-schedule.ts via
// itinerary-plan.ts computeDayTimes), so the timeline and the list can't disagree on a time.

import type { DaySchedule } from './itinerary-schedule'

export const PX_PER_MIN = 1.2 // 15 hours ≈ 1080 px
export const AXIS_START_MIN = 8 * 60
export const AXIS_END_MIN = 23 * 60
// A block is never thinner than this, so a 5-min visit is still readable and tappable.
export const MIN_BLOCK_PX = 26

export type TimelineRange = { start: number; end: number }

// 08:00–23:00, widened to whole hours when a trip or a visit falls outside.
export function timelineRange(sched: DaySchedule): TimelineRange {
  let start = AXIS_START_MIN
  let end = AXIS_END_MIN
  sched.stops.forEach((x) => {
    start = Math.min(start, x.arrival - x.travelIn.minutes, x.start)
    end = Math.max(end, x.end)
  })
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 }
}

export function offsetFor(minutes: number, range: TimelineRange): number {
  return Math.round((minutes - range.start) * PX_PER_MIN)
}

export type TimelineItem =
  | { kind: 'travel'; index: number; top: number; height: number; minutes: number; mode: 'walk' | 'train' | null }
  | { kind: 'stop'; index: number; top: number; height: number; start: number; end: number; arrival: number }

// One "stop" item per visit (top at its start, height ∝ its duration) and one "travel" item for
// each trip that takes time, ending when you arrive (for a fixed-time stop, at its arrive-by).
export function timelineItems(sched: DaySchedule, range: TimelineRange): TimelineItem[] {
  const items: TimelineItem[] = []
  sched.stops.forEach((x, i) => {
    if (x.travelIn.minutes > 0) {
      const top = offsetFor(x.arrival - x.travelIn.minutes, range)
      items.push({ kind: 'travel', index: i, top, height: Math.max(4, offsetFor(x.arrival, range) - top), minutes: x.travelIn.minutes, mode: x.travelIn.mode })
    }
    const top = offsetFor(x.start, range)
    items.push({ kind: 'stop', index: i, top, height: Math.max(MIN_BLOCK_PX, offsetFor(x.end, range) - top), start: x.start, end: x.end, arrival: x.arrival })
  })
  return items
}

// A tap at `offsetPx` from the top of the axis -> the time there, rounded to 15 minutes.
export function minutesAtOffset(offsetPx: number, range: TimelineRange): number {
  const raw = range.start + offsetPx / PX_PER_MIN
  return Math.min(range.end, Math.max(range.start, Math.round(raw / 15) * 15))
}

// Where a stop added at `minutes` goes in the day's order: after the last stop that starts at
// or before that time (it is NOT pinned there — the day is recalculated, so its time may move).
export function insertIndexForTime(starts: number[], minutes: number): number {
  let idx = 0
  starts.forEach((s, i) => { if (s <= minutes) idx = i + 1 })
  return idx
}
