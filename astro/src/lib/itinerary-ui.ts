// The itinerary's interactive parts, shared by /itinerary-list (the list) and /itinerary (the timeline):
// the Leaflet map, the per-leg travel time editor, the "Check day" results and the "Suggest
// route" preview with Apply/Undo. They build the same elements and classes on both pages (styled
// by src/styles/itinerary-shared.css). Changing the plan is always left to the page, through the
// callbacks — so each page saves through its own state/saveState/render, as before.

import { transitRouteUrl, leaveReminderIcs, leaveRemindersIcs, reminderTitle, type TravelLeg, type DaySchedule, type ReminderInput } from './itinerary-schedule'
import { formatClock } from './itinerary-review-helpers'
import { resolveStop, parseLatLng, type PlanDay, type PlanShop, type PlanStop } from './itinerary-plan'
import { cdnImage } from './image-url'
import { FOUND_STATUS_LABELS, type FoundItem } from './shop-found'
import { formatPriceNokFirst } from './price-display'

declare global {
  interface Window { L?: any }
}

// Leaflet from unpkg, once per page; resolves false when it can't load (offline).
export function loadLeaflet(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.L) return resolve(true)
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => resolve(true); js.onerror = () => resolve(false)
    document.head.appendChild(js)
  })
}

// The day's map in `el`: the base, the stops numbered in order, a dashed line through them.
// Returns the Leaflet map (for .remove() on re-render), or null without Leaflet.
export function drawDayMap(el: HTMLElement, day: PlanDay, base: { lat: number; lng: number }, shopById: Map<string, PlanShop>): any | null {
  const L = window.L
  if (!L) return null
  const map = L.map(el, { scrollWheelZoom: false })
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
  const latlngs: [number, number][] = [[base.lat, base.lng]]
  const baseIcon = L.divIcon({ className: '', html: '<div class="pin base">🏠</div>', iconSize: [28, 28], iconAnchor: [14, 14] })
  L.marker([base.lat, base.lng], { icon: baseIcon }).addTo(map).bindPopup('Base')
  day.stops.forEach((s, i) => {
    const r = resolveStop(s, shopById)
    if (r.lat == null || r.lng == null) return
    const icon = L.divIcon({ className: '', html: `<div class="pin ${s.tag === 'mat' ? 'food' : s.tag === 'MUST' ? 'must' : ''}">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
    L.marker([r.lat, r.lng], { icon }).addTo(map).bindPopup(`${i + 1}. ${r.name}`)
    latlngs.push([r.lat, r.lng])
  })
  latlngs.push([base.lat, base.lng])
  L.polyline(latlngs, { color: '#f4a24c', weight: 3, opacity: 0.85, dashArray: '6 6' }).addTo(map)
  map.fitBounds(latlngs, { padding: [30, 30] })
  setTimeout(() => map.invalidateSize(), 120)
  return map
}

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// --- The travel time editor for one leg ---------------------------------------------------------
// "🕒 35 min (your time)" / "🚃 ~45 min (estimate)" etc.
export function travelLegText(leg: TravelLeg): string {
  if (leg.source === 'manual') return `🕒 ${leg.minutes} min (your time)`
  if (leg.source === 'note') return `🚃 ~${leg.minutes} min (from the shop note)`
  if (leg.mode === 'train') return `🚃 ~${leg.minutes} min (estimate)`
  if (leg.mode === 'walk') return `🚶 ~${leg.minutes} min (estimate)`
  return '➕ Travel time?'
}

// The editor's inside: minutes, Save, "Use estimate" (when a time is entered), and a Google Maps
// transit link for the leg. The page wraps it in its own element with class "itn-travel-edit".
export function travelEditorInnerHtml(o: {
  manual: number | null
  placeholder: number
  from: { name: string; lat: number | null; lng: number | null }
  to: { name: string; lat: number | null; lng: number | null }
}): string {
  return `
          <label>Travel time <input type="number" class="itn-travel-min" min="0" step="1" value="${o.manual != null ? o.manual : ''}" placeholder="${o.placeholder}" /> min</label>
          <button type="button" class="itn-travel-save">Save</button>
          ${o.manual != null ? '<button type="button" class="itn-travel-clear">Use estimate</button>' : ''}
          <a class="itn-route" href="${esc(transitRouteUrl(o.from, o.to))}" target="_blank" rel="noopener">🗺️ Route</a>
        `
}

// Save -> the minutes (or null for an empty/invalid value: back to the estimate); "Use estimate"
// -> null.
export function bindTravelEditor(ed: Element, onSave: (minutes: number | null) => void): void {
  ed.querySelector('.itn-travel-save')!.addEventListener('click', () => {
    const v = parseInt((ed.querySelector('.itn-travel-min') as HTMLInputElement).value, 10)
    onSave(isNaN(v) || v < 0 ? null : v)
  })
  const clear = ed.querySelector('.itn-travel-clear')
  if (clear) clear.addEventListener('click', () => onSave(null))
}

// --- "Check day" (the AI review, /api/itinerary-review) ---------------------------------------
type CheckItem = { severity: string; stopIndex: number | null; message: string; suggestion: string | null }
type CheckOptions = { stopName: (i: number) => string; onStopClick: (i: number) => void }

export function renderCheckError(resultsEl: HTMLElement, text: string): void {
  resultsEl.replaceChildren()
  const p = document.createElement('p')
  p.className = 'ir-error'
  p.textContent = text
  resultsEl.appendChild(p)
  resultsEl.hidden = false
}

export function renderCheckResults(resultsEl: HTMLElement, items: CheckItem[], opts: CheckOptions): void {
  resultsEl.replaceChildren()
  if (!items.length) {
    const p = document.createElement('p')
    p.className = 'ir-good'
    p.textContent = '✓ Looks good.'
    resultsEl.appendChild(p)
    resultsEl.hidden = false
    return
  }
  const list = document.createElement('ul')
  list.className = 'ir-list'
  items.forEach((item) => {
    const li = document.createElement('li')
    li.className = 'ir-item ' + (item.severity === 'warning' ? 'ir-warning' : 'ir-tip')
    if (typeof item.stopIndex === 'number') {
      const idx = item.stopIndex
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'ir-item-stop-link'
      link.textContent = `Stop ${idx + 1}: ${opts.stopName(idx)}`
      link.addEventListener('click', () => opts.onStopClick(idx))
      li.appendChild(link)
    }
    const msg = document.createElement('p')
    msg.className = 'ir-item-message'
    msg.textContent = item.message
    li.appendChild(msg)
    if (item.suggestion) {
      const sug = document.createElement('p')
      sug.className = 'ir-item-suggestion'
      sug.textContent = `Suggestion: ${item.suggestion}`
      li.appendChild(sug)
    }
    list.appendChild(li)
  })
  resultsEl.appendChild(list)
  resultsEl.hidden = false
}

// Sends the day (itinerary-plan.ts checkDayRequestBody) and shows the result in `resultsEl`; the
// button reads "Checking…" meanwhile. Resolves to the items (or null on an error) so the page can
// also mark its stops. Read-only: the plan itself is never changed by a review.
export async function runCheckDay(btn: HTMLButtonElement, resultsEl: HTMLElement, body: unknown, opts: CheckOptions): Promise<CheckItem[] | null> {
  btn.disabled = true
  const originalText = btn.textContent
  btn.textContent = 'Checking…'
  resultsEl.hidden = true
  resultsEl.replaceChildren()
  try {
    const res = await fetch('/api/itinerary-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      renderCheckError(resultsEl, data.error || 'Check failed.')
      return null
    }
    const items = data.items || []
    renderCheckResults(resultsEl, items, opts)
    return items
  } catch (e) {
    renderCheckError(resultsEl, 'Network error.')
    return null
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
}

// --- "Suggest route" (route-optimizer.ts, never the AI) ----------------------------------------
type RouteResult = {
  order: number[]
  currentOrder: number[]
  suggested: { times: number[]; score: number }
  current: { times: number[]; score: number }
  usedFirstStopAsStart: boolean
  improved: boolean
}

export function renderNoStopsToReorder(resultsEl: HTMLElement): void {
  resultsEl.replaceChildren()
  const p = document.createElement('p')
  p.className = 'ir-error'
  p.textContent = 'No stops to reorder.'
  resultsEl.appendChild(p)
  resultsEl.hidden = false
}

// The current and suggested order side by side, with times and "Saves ~N min travel.", and an
// Apply button when it's an improvement. Showing it changes nothing; Apply calls onApply.
export function renderRouteSuggestion(
  resultsEl: HTMLElement,
  result: RouteResult,
  opts: { stopName: (origIdx: number) => string; fmt: (minutes: number) => string; onApply: () => void }
): void {
  resultsEl.replaceChildren()
  const summary = document.createElement('p')
  summary.className = 'rt-summary'
  if (result.improved) {
    const savedMin = Math.round(result.current.score - result.suggested.score)
    summary.textContent = `Saves ~${savedMin} min travel.`
  } else {
    summary.textContent = 'Current order is already best.'
  }
  resultsEl.appendChild(summary)
  if (result.usedFirstStopAsStart) {
    const note = document.createElement('p')
    note.className = 'rt-note'
    note.textContent = 'No start location set for this day — using the first stop as the starting point.'
    resultsEl.appendChild(note)
  }
  function buildColumn(title: string, order: number[], schedule: { times: number[] }) {
    const col = document.createElement('div')
    col.className = 'rt-column'
    const h = document.createElement('p')
    h.className = 'rt-column-title'
    h.textContent = title
    col.appendChild(h)
    const list = document.createElement('ol')
    list.className = 'rt-list'
    order.forEach((origIdx, pos) => {
      const li = document.createElement('li')
      li.className = 'rt-list-item'
      li.textContent = `${opts.fmt(schedule.times[pos])} ${opts.stopName(origIdx)}`
      list.appendChild(li)
    })
    col.appendChild(list)
    return col
  }
  const cols = document.createElement('div')
  cols.className = 'rt-columns'
  cols.appendChild(buildColumn('Current', result.currentOrder, result.current))
  cols.appendChild(buildColumn('Suggested', result.order, result.suggested))
  resultsEl.appendChild(cols)
  if (result.improved) {
    const applyBtn = document.createElement('button')
    applyBtn.type = 'button'
    applyBtn.className = 'rt-apply-btn'
    applyBtn.textContent = 'Apply'
    applyBtn.addEventListener('click', () => opts.onApply())
    resultsEl.appendChild(applyBtn)
  }
  resultsEl.hidden = false
}

// After Apply: "Route applied ✓" and an Undo button.
export function renderRouteApplied(el: HTMLElement, onUndo: () => void): void {
  el.replaceChildren()
  const p = document.createElement('p')
  p.className = 'ir-good'
  p.textContent = 'Route applied ✓'
  const undoBtn = document.createElement('button')
  undoBtn.type = 'button'
  undoBtn.className = 'rt-undo-btn'
  undoBtn.textContent = 'Undo'
  undoBtn.addEventListener('click', () => onUndo())
  el.appendChild(p)
  el.appendChild(undoBtn)
  el.hidden = false
}

// --- A stop's coordinates (the list's ⋯ menu and the timeline's edit sheet) ---------------------
// `save` stores the plan, `msg` shows a status line, `done` re-renders (1.4 s later, so the
// message can be read first). A stop linked to a shop also gets the coordinates saved on the shop
// in Sanity (/api/shop-coords).
type CoordCallbacks = { save: () => void; msg: (text: string, color: string) => void; done: () => void }

export async function saveStopCoords(stop: PlanStop, text: string, cb: CoordCallbacks): Promise<void> {
  const parsed = parseLatLng(text)
  if (!parsed) { cb.msg('Skriv «lat, lng» — f.eks. 35.6990, 139.7710', '#e74c3c'); return }
  stop.lat = parsed.lat; stop.lng = parsed.lng
  cb.save()
  if (stop.shopId) {
    cb.msg('Lagrer til butikken…', 'var(--muted)')
    try {
      const res = await fetch('/api/shop-coords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: stop.shopId, latitude: parsed.lat, longitude: parsed.lng }),
      })
      cb.msg(res.ok ? 'Lagret ✓ — også til butikken i Sanity' : 'Lagret lokalt, men Sanity-lagring feilet', res.ok ? '#2ecc71' : '#e74c3c')
    } catch (e) { cb.msg('Lagret lokalt (ingen nett til Sanity)', '#e74c3c') }
  } else {
    cb.msg('Lagret ✓ (ikke koblet til en butikk)', '#2ecc71')
  }
  setTimeout(cb.done, 1400)
}

// The coordinates from the linked shop in Sanity.
export async function fetchStopCoordsFromShop(stop: PlanStop, cb: CoordCallbacks): Promise<void> {
  if (!stop.shopId) return
  cb.msg('Henter fra butikken…', 'var(--muted)')
  try {
    const res = await fetch('/api/shop-coords?id=' + encodeURIComponent(stop.shopId))
    const data = await res.json()
    if (!res.ok || !data.ok) { cb.msg('Henting feilet.', '#e74c3c'); return }
    if (!data.found) { cb.msg('Fant ikke butikken i Sanity.', '#e74c3c'); return }
    if (!data.hasCoords) { cb.msg('Butikken har ingen koordinater ennå.', '#e74c3c'); return }
    stop.lat = data.latitude; stop.lng = data.longitude
    cb.save()
    cb.msg('Hentet ✓ — koordinater satt fra butikken', '#2ecc71')
    setTimeout(cb.done, 1400)
  } catch (e) {
    cb.msg('Nettverksfeil ved henting.', '#e74c3c')
  }
}

// --- "⏰ Reminder" -----------------------------------------------------------------------------
// An .ics calendar event for leaving stop `si` for the next one at its leave-by time
// (itinerary-schedule.ts leaveReminderIcs: Asia/Tokyo, the JST title), as a data: link the phone's
// calendar opens — with a space before it, for after "Leave by HH:MM". '' on the day's last stop
// (nowhere to go next) or a day without a date. `iconOnly`: just "⏰" (the timeline's narrow blocks).
export function reminderLinkHtml(day: PlanDay, si: number, leaveBy: number, shopById: Map<string, PlanShop>, iconOnly = false): string {
  if (!day.day || !day.stops[si + 1]) return ''
  const from = resolveStop(day.stops[si], shopById), to = resolveStop(day.stops[si + 1], shopById)
  const ics = leaveReminderIcs(reminderFor(day, si, leaveBy, shopById))
  const file = `leave-${day.day}-${formatClock(leaveBy).replace(':', '')}.ics`
  return ` <a class="itn-reminder" href="data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}" download="${file}"${iconOnly ? ' aria-label="Reminder" title="Reminder"' : ''}>⏰${iconOnly ? '' : ' Reminder'}</a>`
}

// --- The linked shop's photos -----------------------------------------------------------------
// shopNote.photos (floor guides, shelves …) with their captions as a small strip — in the
// timeline's edit sheet and the list's ⋯ panel; a tap opens the lightbox (public/lightbox.js).
// Small CDN images; '' when the shop has none (or there's no shop).
export function shopPhotoStripHtml(shop: PlanShop | null | undefined): string {
  const photos = (shop?.photos || []).filter((p) => p && p.url)
  if (!photos.length) return ''
  const name = shop!.shopName || 'Shop'
  return `<div class="shop-photo-strip" aria-label="Shop photos">${photos.map((p) =>
    `<figure class="shop-photo"><img src="${esc(cdnImage(p.url, 160))}" data-lightbox="${esc(cdnImage(p.url, 2000))}" alt="${esc(p.caption || `${name} photo`)}" loading="lazy" />${
      p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`
}

// "Found here" at the linked shop (lib/shop-found.ts, the shop page's list) as a strip under its
// photos: photo (lightbox on tap) or 📦, name, price in NOK with ≈ JPY, status. '' for none.
// `priceQuery`: added to a price's /edit-price link (the name), e.g. the way back to the
// timeline; with it, a price still Considering also gets a "✅ Bought" button (data-id).
export function foundStripHtml(items: FoundItem[] | null | undefined, rate: number | null, priceQuery?: string): string {
  if (!items || !items.length) return ''
  return `<div class="found-strip" aria-label="Found here">${items.map((i) => {
    const name = i.href && priceQuery != null
      ? `<a class="found-name found-link" href="${esc(`${i.href}${priceQuery ? `&${priceQuery}` : ''}`)}">${esc(i.name)}</a>`
      : `<span class="found-name">${esc(i.name)}</span>`
    const buy = priceQuery != null && i.kind === 'price' && i.status === 'considering'
      ? `<button type="button" class="found-buy" data-id="${esc(i.id)}">✅ Bought</button>`
      : ''
    return `<figure class="found-item" data-id="${esc(i.id)}">${
      i.imageUrl
        ? `<img src="${esc(cdnImage(i.imageUrl, 160))}" data-lightbox="${esc(cdnImage(i.imageUrl, 2000))}" alt="${esc(i.name)}" loading="lazy" />`
        : '<span class="found-none" aria-hidden="true">📦</span>'
    }<figcaption>${name}${
      i.price != null ? `<span class="found-price">${esc(formatPriceNokFirst(i.price, i.currency, rate))}</span>` : ''
    }<span class="found-status found-${i.status}">${FOUND_STATUS_LABELS[i.status]}</span>${buy}</figcaption></figure>`
  }).join('')}</div>`
}

// The reminder for leaving stop `si` (see itinerary-schedule.ts ReminderInput): keyed by the
// stop's shop, else its name, plus a count when the same stop is on the day twice.
function reminderFor(day: PlanDay, si: number, leaveBy: number, shopById: Map<string, PlanShop>): ReminderInput {
  const keyOf = (i: number) => day.stops[i].shopId || resolveStop(day.stops[i], shopById).name
  const key = keyOf(si)
  const before = day.stops.slice(0, si).filter((_, i) => keyOf(i) === key).length
  const from = resolveStop(day.stops[si], shopById), to = resolveStop(day.stops[si + 1], shopById)
  const train = day.stops[si + 1].train
  return { date: day.day, leaveBy, from: from.name, to: to.name, routeUrl: transitRouteUrl(from, to), key: before ? `${key}-${before + 1}` : key, ...(train?.departure ? { trainDeparture: train.departure } : {}) }
}

// "⏰ Reminders for this day": every leave-by time on the day (the same ones that get a
// "⏰ Reminder" link), in order, with its title.
export function dayReminders(day: PlanDay, sched: DaySchedule, shopById: Map<string, PlanShop>): { si: number; title: string; reminder: ReminderInput }[] {
  if (!day.day) return []
  return sched.stops.flatMap((x, si) => {
    if (x.leaveBy == null || !day.stops[si + 1]) return []
    const reminder = reminderFor(day, si, x.leaveBy, shopById)
    return [{ si, title: reminderTitle(reminder.from, reminder.leaveBy, reminder.to, reminder.trainDeparture), reminder }]
  })
}
// One .ics file with the chosen ones, as a data: link (like the single reminder).
export function remindersHref(list: ReminderInput[]): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(leaveRemindersIcs(list))}`
}
