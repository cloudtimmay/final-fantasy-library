// The place search box (lib/place-search.ts through /api/place-search): on "Add place", in the
// timeline's add-stop form, and "📍 Find location". Results to choose from, with OpenStreetMap's
// attribution. Searches after a pause in typing (the server keeps to one request a second).
// Also: a pasted Google Maps link becomes a result to confirm (/api/maps-link, lib/google-maps-link.ts
// — no Google API, no Google page read); OpenStreetMap finding nothing retries a simplified
// search on the server; and still nothing offers "✨ Search with AI" (/api/shop-info's web search,
// only on tap).
import type { PlaceResult } from './place-search'
import { isGoogleMapsUrl } from './google-maps-link'

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
    .ps-note { display: block; color: #2ecc71; font-size: 0.75rem; font-weight: 600; margin-top: 0.15rem; }
    .ps-ai { margin-top: 0.4rem; background: var(--surface); color: var(--text); border: 1px solid var(--accent); border-radius: 6px; padding: 0.4rem 0.7rem; font: inherit; font-size: 0.85rem; cursor: pointer; min-height: 36px; }
    .ps-ai:disabled { opacity: 0.6; }
    .ps-ai[hidden] { display: none; }
    .ps-linkrow { display: flex; gap: 0.35rem; margin-top: 0.45rem; }
    .ps-linkrow input { flex: 1; min-width: 0; font: inherit; font-size: 0.85rem; padding: 0.4rem 0.5rem; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .ps-linkrow button { font: inherit; font-size: 0.8rem; padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
  `
  document.head.appendChild(style)
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// OpenStreetMap's matches; `simplified`: the shorter search the server tried when the full one
// found nothing ("SURUGA-YA Akihabara" for "SURUGA-YA Main Store SURUGA-YA Bldg"), else null.
export async function fetchPlaces(q: string, area?: string | null): Promise<{ results: PlaceResult[]; simplified: string | null }> {
  const res = await fetch(`/api/place-search?q=${encodeURIComponent(q)}${area ? `&area=${encodeURIComponent(area)}` : ''}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Search failed')
  return { results: Array.isArray(data.results) ? data.results : [], simplified: typeof data.simplified === 'string' ? data.simplified : null }
}

// A pasted Google Maps link → its place (coordinates, and its name when the link has one).
export async function fetchLinkPlace(url: string): Promise<PlaceResult> {
  const res = await fetch(`/api/maps-link?url=${encodeURIComponent(url)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.result) throw new Error(data.error || 'Could not read a place from that link.')
  return data.result
}

// "✨ Search with AI": /api/shop-info's web search (validated inside Japan, near the area) — a
// place to confirm, or null when it found no location.
export async function fetchAiPlace(name: string, area?: string | null): Promise<PlaceResult | null> {
  const res = await fetch('/api/shop-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopName: name, area: area || '' }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'The AI search failed.')
  const r = data.result
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null
  return {
    name, address: typeof r.address === 'string' ? r.address : '',
    lat: r.latitude, lng: r.longitude,
    kind: 'found with AI web search', placeType: 'shop', area: area || null,
    openingHours: typeof r.openingHours === 'string' ? r.openingHours : null,
    osmId: `ai:${r.latitude.toFixed(6)},${r.longitude.toFixed(6)}`,
  }
}

type RenderExtra = { header?: string; osm?: boolean; ai?: { name: string; area?: string | null; limit?: number } }

// Renders `places` into `results` as buttons; `onChoose` with the one picked.
// `note`: an extra line for a result, e.g. "✓ Animate · 2. des" (a saved place already in the plan).
// `extra.header`: a line above them; `extra.osm`: OpenStreetMap's attribution (its results);
// `extra.ai`: none found — offer "✨ Search with AI" for that name.
export function renderPlaces(results: HTMLElement, places: PlaceResult[], onChoose: (p: PlaceResult) => void, empty = 'No matches.', note?: (p: PlaceResult) => string, extra: RenderExtra = { osm: true }): void {
  ensureStyle()
  results.hidden = false
  results.innerHTML = (extra.header ? `<p class="ps-msg">${esc(extra.header)}</p>` : '')
    + (places.length
      ? `<ul class="ps-list">${places.map((p, i) => {
        const line = note ? note(p) : ''
        return `<li><button type="button" class="ps-result" data-i="${i}"><span class="ps-name">${esc(p.name)}</span><span class="ps-kind">${esc(p.kind)}</span><span class="ps-addr">${esc(p.address)}</span>${line ? `<span class="ps-note">${esc(line)}</span>` : ''}</button></li>`
      }).join('')}</ul>`
      : `<p class="ps-msg">${esc(empty)}</p>${extra.ai ? '<button type="button" class="ps-ai">✨ Search with AI</button>' : ''}`)
    + (extra.osm !== false ? '<p class="ps-attr">Search: © OpenStreetMap contributors</p>' : '')
  results.querySelectorAll<HTMLButtonElement>('.ps-result').forEach((b) => b.addEventListener('click', () => onChoose(places[Number(b.dataset.i)])))
  const aiBtn = results.querySelector('.ps-ai') as HTMLButtonElement | null
  if (aiBtn && extra.ai) {
    const ai = extra.ai
    aiBtn.addEventListener('click', async () => {
      aiBtn.disabled = true
      aiBtn.textContent = '✨ Searching the web…'
      try {
        const found = await fetchAiPlace(ai.name, ai.area)
        if (found) renderPlaces(results, [found], onChoose, empty, note, { header: '✨ Found with an AI web search — check it before choosing:', osm: false })
        else { aiBtn.hidden = true; aiBtn.insertAdjacentHTML('afterend', `<p class="ps-msg">✨ The AI search found no location for “${esc(ai.name)}”.</p>`) }
      } catch (e) {
        aiBtn.disabled = false
        aiBtn.textContent = '✨ Search with AI'
        aiBtn.insertAdjacentHTML('afterend', `<p class="ps-msg">⚠️ ${esc(e instanceof Error ? e.message : 'The AI search failed.')}</p>`)
      }
    })
  }
}

// One search, shared by the boxes: a Google Maps link → its place; else OpenStreetMap (the
// server's simplified retry included) → its matches, or "✨ Search with AI" when none.
async function runSearch(results: HTMLElement, query: string, onChoose: (p: PlaceResult) => void, o: { area?: string | null; note?: (p: PlaceResult) => string; limit?: number; header?: string; empty?: string; current?: () => boolean }): Promise<void> {
  const current = o.current || (() => true)
  try {
    if (isGoogleMapsUrl(query)) {
      const place = await fetchLinkPlace(query)
      if (current()) renderPlaces(results, [place], onChoose, undefined, o.note, { header: 'From the Google Maps link — check it before choosing:', osm: false })
      return
    }
    const { results: found, simplified } = await fetchPlaces(query, o.area)
    if (!current()) return
    const places = typeof o.limit === 'number' ? found.slice(0, o.limit) : found
    const header = places.length
      ? [simplified ? `No matches for “${query}” — results for “${simplified}”:` : '', o.header || ''].filter(Boolean).join(' ')
      : ''
    renderPlaces(results, places, onChoose, o.empty || 'No matches.', o.note, { header: header || undefined, osm: true, ai: { name: query, area: o.area } })
  } catch (e) {
    if (current()) results.innerHTML = `<p class="ps-msg">⚠️ ${esc(e instanceof Error && isGoogleMapsUrl(query) ? e.message : 'The search failed — try again.')}</p>`
  }
}

// "📍 Find location": a search with the place's name and area, its top matches to confirm one;
// below them a box for a pasted Google Maps link instead.
export const FIND_LOCATION_MATCHES = 3
export function findLocationQuery(name: string, area?: string | null): string {
  return [name, area].map((s) => (s || '').trim()).filter(Boolean).join(' ')
}
// `what`: the search, or { query, area } (the area also helps the simplified retry and the AI search).
export async function findLocation(results: HTMLElement, what: string | { query: string; area?: string | null }, onChoose: (p: PlaceResult) => void): Promise<void> {
  const query = typeof what === 'string' ? what : what.query
  const area = typeof what === 'string' ? null : what.area || null
  ensureStyle()
  results.hidden = false
  if (query.length < 2) { results.innerHTML = '<p class="ps-msg">No name to search for.</p>'; return }
  results.innerHTML = `<p class="ps-msg">Searching for “${esc(query)}”…</p>`
  const linkRow = () => {
    results.insertAdjacentHTML('beforeend', '<div class="ps-linkrow"><input class="ps-link" type="url" placeholder="…or paste a Google Maps link" aria-label="Google Maps link" /><button type="button" class="ps-link-use">Use link</button></div>')
    const input = results.querySelector('.ps-link') as HTMLInputElement
    const use = async () => {
      const url = input.value.trim()
      if (!url) return
      await runSearch(results, url, onChoose, {})
      if (!results.querySelector('.ps-linkrow')) linkRow()
    }
    results.querySelector('.ps-link-use')!.addEventListener('click', use)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); use() } })
  }
  await runSearch(results, query, onChoose, { area, limit: FIND_LOCATION_MATCHES, header: 'Which one is it? Choosing one saves its location.', empty: `No matches for “${query}” — paste a Google Maps link or coordinates instead.` })
  linkRow()
}

export function attachPlaceSearch(o: { input: HTMLInputElement; button?: HTMLElement | null; results: HTMLElement; onChoose: (p: PlaceResult) => void; debounceMs?: number; note?: (p: PlaceResult) => string; area?: () => string | null | undefined }): { search: (q?: string) => Promise<void> } {
  ensureStyle()
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  async function search(q = o.input.value) {
    const query = q.trim()
    if (query.length < 2) { o.results.hidden = true; o.results.innerHTML = ''; return }
    const mine = ++seq
    o.results.hidden = false
    o.results.innerHTML = `<p class="ps-msg">${isGoogleMapsUrl(query) ? 'Reading the link…' : 'Searching…'}</p>`
    await runSearch(o.results, query, o.onChoose, { area: o.area ? o.area() || null : null, note: o.note, current: () => mine === seq })
  }
  o.input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => search(), o.debounceMs ?? 700)
  })
  o.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); search() } })
  o.button?.addEventListener('click', () => { clearTimeout(timer); search() })
  return { search }
}
