// Layout for /itinerary-timeline: where each stop and each trip between stops sits on a day's
// vertical time axis. Pure arithmetic over the shared timetable (itinerary-schedule.ts via
// itinerary-plan.ts computeDayTimes), so the timeline and the list can't disagree on a time.

import type { DaySchedule } from './itinerary-schedule'

// Zoom: pixels per minute. The default, 2.25 px/min, makes an hour 135 px (the first version had
// 72, which hid names in short visits; 180 was more than needed) — a 30-min visit (~68 px) still
// fits its name, time and opening hours on a phone. "−"/"+" step through the levels.
export const ZOOM_LEVELS = [1.5, 2.25, 3, 4, 5.5]
export const DEFAULT_ZOOM_INDEX = 1
export const DEFAULT_PX_PER_MIN = ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]
export const AXIS_START_MIN = 8 * 60
export const AXIS_END_MIN = 23 * 60
// A block is never thinner than this: always room for its first line (name · time), and tappable.
export const MIN_BLOCK_PX = 30

export type TimelineRange = { start: number; end: number }

// 08:00–23:00, widened to whole hours when a trip or a visit falls outside.
// Room for the "🏠 Start: base" and "🏠 Back at base" labels above and below the day.
export const BASE_LABEL_MIN = 20
export function timelineRange(sched: DaySchedule): TimelineRange {
  let start = AXIS_START_MIN
  let end = AXIS_END_MIN
  sched.stops.forEach((x, i) => {
    start = Math.min(start, x.arrival - x.travelIn.minutes - (i === 0 ? BASE_LABEL_MIN : 0), x.start)
    end = Math.max(end, x.end)
  })
  if (sched.stops.length) end = Math.max(end, sched.end + BASE_LABEL_MIN) // back at the base
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 }
}

export function offsetFor(minutes: number, range: TimelineRange, px: number = DEFAULT_PX_PER_MIN): number {
  return Math.round((minutes - range.start) * px)
}

export type TimelineItem =
  // `back`: the trip from the last stop back to the base (index = the number of stops).
  | { kind: 'travel'; index: number; top: number; height: number; minutes: number; mode: 'walk' | 'train' | null; back?: boolean }
  | { kind: 'stop'; index: number; top: number; height: number; start: number; end: number; arrival: number }

// One "stop" item per visit (top at its start, height ∝ its duration) and one "travel" item for
// each trip that takes time, ending when you arrive (for a fixed-time stop, at its arrive-by).
export function timelineItems(sched: DaySchedule, range: TimelineRange, px: number = DEFAULT_PX_PER_MIN): TimelineItem[] {
  const items: TimelineItem[] = []
  sched.stops.forEach((x, i) => {
    if (x.travelIn.minutes > 0) {
      const top = offsetFor(x.arrival - x.travelIn.minutes, range, px)
      items.push({ kind: 'travel', index: i, top, height: Math.max(4, offsetFor(x.arrival, range, px) - top), minutes: x.travelIn.minutes, mode: x.travelIn.mode })
    }
    const top = offsetFor(x.start, range, px)
    items.push({ kind: 'stop', index: i, top, height: Math.max(MIN_BLOCK_PX, offsetFor(x.end, range, px) - top), start: x.start, end: x.end, arrival: x.arrival })
  })
  // And back to the base after the last stop (itinerary-schedule.ts returnLeg, as on the list).
  const last = sched.stops[sched.stops.length - 1]
  if (last && sched.returnLeg && sched.returnLeg.minutes > 0) {
    const top = offsetFor(last.end, range, px)
    items.push({ kind: 'travel', index: sched.stops.length, top, height: Math.max(4, offsetFor(sched.end, range, px) - top), minutes: sched.returnLeg.minutes, mode: sched.returnLeg.mode, back: true })
  }
  return items
}

// A tap at `offsetPx` from the top of the axis -> the time there, rounded to 15 minutes.
export function minutesAtOffset(offsetPx: number, range: TimelineRange, px: number = DEFAULT_PX_PER_MIN): number {
  const raw = range.start + offsetPx / px
  return Math.min(range.end, Math.max(range.start, Math.round(raw / 15) * 15))
}

// Where a stop added at `minutes` goes in the day's order: after the last stop that starts at
// or before that time (it is NOT pinned there — the day is recalculated, so its time may move).
export function insertIndexForTime(starts: number[], minutes: number): number {
  let idx = 0
  starts.forEach((s, i) => { if (s <= minutes) idx = i + 1 })
  return idx
}

// --- Placing the items so nothing covers anything --------------------------------------------
// Travel has its own narrow lane on the right, so a trip never covers a stop. A leg too short to
// hold its label inside its own height is drawn as a small chip instead of a striped band.
export const TRAVEL_LABEL_PX = 20

// A stop's column: stops whose visible blocks overlap in time — two stops at once, or a short
// block stretched to MIN_BLOCK_PX reaching into the next one — sit side by side like calendar
// events, each `1/cols` wide, so every one stays readable.
export type PlacedStop = Extract<TimelineItem, { kind: 'stop' }> & { col: number; cols: number }
export type PlacedTravel = Extract<TimelineItem, { kind: 'travel' }> & { chip: boolean; chipTop: number }
export const CHIP_PX = 18

export function layoutTimeline(sched: DaySchedule, range: TimelineRange, px: number = DEFAULT_PX_PER_MIN): { stops: PlacedStop[]; travel: PlacedTravel[] } {
  const items = timelineItems(sched, range, px)

  // Columns: sweep the stops by top; a cluster is a run of transitively overlapping blocks.
  const stops = items
    .filter((i): i is Extract<TimelineItem, { kind: 'stop' }> => i.kind === 'stop')
    .map((s) => ({ ...s, col: 0, cols: 1 }))
    .sort((a, b) => a.top - b.top || a.index - b.index)
  let cluster: PlacedStop[] = []
  let clusterBottom = -Infinity
  let colBottoms: number[] = []
  const closeCluster = () => { cluster.forEach((s) => { s.cols = colBottoms.length }); cluster = []; colBottoms = [] }
  stops.forEach((s) => {
    if (s.top >= clusterBottom) closeCluster()
    let col = colBottoms.findIndex((bottom) => bottom <= s.top)
    if (col < 0) { col = colBottoms.length; colBottoms.push(0) }
    colBottoms[col] = s.top + s.height
    s.col = col
    cluster.push(s)
    clusterBottom = Math.max(clusterBottom, s.top + s.height)
  })
  closeCluster()

  // Travel: a band when the label fits, otherwise a chip centred on the leg — pushed down when it
  // would touch the previous chip.
  let lastChipBottom = -Infinity
  const travel = items
    .filter((i): i is Extract<TimelineItem, { kind: 'travel' }> => i.kind === 'travel')
    .map((t) => {
      const chip = t.height < TRAVEL_LABEL_PX
      let chipTop = Math.round(t.top + t.height / 2 - CHIP_PX / 2)
      if (chip) { chipTop = Math.max(chipTop, lastChipBottom + 2); lastChipBottom = chipTop + CHIP_PX }
      return { ...t, chip, chipTop }
    })
  return { stops: stops.sort((a, b) => a.index - b.index), travel }
}
