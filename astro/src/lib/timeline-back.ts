// "← Back to timeline" on a page opened from the timeline's edit sheet (/edit-store from the
// shop's name, /edit-price from a "Found here" item): ?from=timeline&day=YYYY-MM-DD&trip=<id>.
// The link goes to /itinerary on that day and trip — each checked first, so nothing else from
// the address ends up in it. null when the page wasn't opened from the timeline.
export function timelineBackUrl(params: URLSearchParams): string | null {
  if (params.get('from') !== 'timeline') return null
  const back = new URLSearchParams()
  const day = params.get('day') || ''
  const trip = params.get('trip') || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) back.set('day', day)
  if (/^[\w.-]{1,100}$/.test(trip)) back.set('trip', trip)
  return `/itinerary${back.toString() ? `?${back.toString()}` : ''}`
}

// The query the timeline adds to such a link (the other side of timelineBackUrl).
export function fromTimelineQuery(day: string, trip: string | null | undefined): string {
  const params = new URLSearchParams({ from: 'timeline', day })
  if (trip) params.set('trip', trip)
  return params.toString()
}
