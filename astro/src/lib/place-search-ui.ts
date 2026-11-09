// The place search box (lib/place-search.ts through /api/place-search): on "Add place", in the
// timeline's add-stop form, and "📍 Find location". Results to choose from, with OpenStreetMap's
// attribution. Searches after a pause in typing (the server keeps to one request a second).
import type { PlaceResult } from './place-search'

const STYLE_ID = 'ps-style'
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .ps-list { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
    .ps-result { width: 100%; text-align: left; padding: 0.45rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 0.85rem; }
    .ps-result:hover, .ps-result:focus { border-color: var(--accent); }
    .ps-name { font-weight: 600; }
    .ps-kind { color: var(--accent); font-size: 0.75rem; margin-left: 0.3rem; }
    .ps-addr { display: block; color: var(--muted); font-size: 0.75rem; margin-top: 0.15rem; overflow-wrap: anywhere; }
    .ps-msg { margin: 0.35rem 0 0; font-size: 0.8rem; color: var(--muted); }
    .ps-attr { margin: 0.35rem 0 0; font-size: 0.7rem; color: var(--muted); }
  `
  document.head.appendChild(style)
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function fetchPlaces(q: string): Promise<PlaceResult[]> {
  const res = await fetch(`/api/place-search?q=${encodeURIComponent(q)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Search failed')
  return Array.isArray(data.results) ? data.results : []
}

// Renders `places` into `results` as buttons; `onChoose` with the one picked.
export function renderPlaces(results: HTMLElement, places: PlaceResult[], onChoose: (p: PlaceResult) => void, empty = 'No matches.'): void {
  ensureStyle()
  results.hidden = false
  results.innerHTML = (places.length
    ? `<ul class="ps-list">${places.map((p, i) => `<li><button type="button" class="ps-result" data-i="${i}"><span class="ps-name">${esc(p.name)}</span><span class="ps-kind">${esc(p.kind)}</span><span class="ps-addr">${esc(p.address)}</span></button></li>`).join('')}</ul>`
    : `<p class="ps-msg">${esc(empty)}</p>`)
    + '<p class="ps-attr">Search: © OpenStreetMap contributors</p>'
  results.querySelectorAll<HTMLButtonElement>('.ps-result').forEach((b) => b.addEventListener('click', () => onChoose(places[Number(b.dataset.i)])))
}

// "📍 Find location": a search with the place's name and area, its top matches to confirm one.
export const FIND_LOCATION_MATCHES = 3
export function findLocationQuery(name: string, area?: string | null): string {
  return [name, area].map((s) => (s || '').trim()).filter(Boolean).join(' ')
}
export async function findLocation(results: HTMLElement, query: string, onChoose: (p: PlaceResult) => void): Promise<void> {
  ensureStyle()
  results.hidden = false
  if (query.length < 2) { results.innerHTML = '<p class="ps-msg">No name to search for.</p>'; return }
  results.innerHTML = `<p class="ps-msg">Searching for “${esc(query)}”…</p>`
  try {
    const places = (await fetchPlaces(query)).slice(0, FIND_LOCATION_MATCHES)
    renderPlaces(results, places, onChoose, `No matches for “${query}” — paste coordinates instead.`)
    if (places.length) results.insertAdjacentHTML('afterbegin', '<p class="ps-msg">Which one is it? Choosing one saves its location.</p>')
  } catch (e) {
    results.innerHTML = '<p class="ps-msg">⚠️ The search failed — try again.</p>'
  }
}

export function attachPlaceSearch(o: { input: HTMLInputElement; button?: HTMLElement | null; results: HTMLElement; onChoose: (p: PlaceResult) => void; debounceMs?: number }): { search: (q?: string) => Promise<void> } {
  ensureStyle()
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  async function search(q = o.input.value) {
    const query = q.trim()
    if (query.length < 2) { o.results.hidden = true; o.results.innerHTML = ''; return }
    const mine = ++seq
    o.results.hidden = false
    o.results.innerHTML = '<p class="ps-msg">Searching…</p>'
    try {
      const places = await fetchPlaces(query)
      if (mine !== seq) return // a newer search is on its way
      renderPlaces(o.results, places, o.onChoose)
    } catch (e) {
      if (mine === seq) o.results.innerHTML = '<p class="ps-msg">⚠️ The search failed — try again.</p>'
    }
  }
  o.input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => search(), o.debounceMs ?? 700)
  })
  o.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); search() } })
  o.button?.addEventListener('click', () => { clearTimeout(timer); search() })
  return { search }
}
