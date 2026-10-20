// Shared "✨ Fill in from web" suggestion-card flow for the four collection-item edit modes
// (games/books/merchandise/albums), modeled on edit-store.astro's own (page-specific, not
// shared) AI-fill feature. Calls /api/item-info and renders one checkbox row per field the
// endpoint found, "Apply selected" copying only the checked ones into the live edit form —
// it never saves anything itself, same as edit-store.astro's version.
//
// Usage:
//   window.createItemInfoFlow({
//     type: 'album' | 'game' | 'book' | 'figure',
//     els: { btn, msg, resultsWrap },
//     getQuery: () => ({ title, barcode, isbn, creator }),  // only the keys item-info.ts needs
//     fields: [{
//       key: 'genre',                 // matches a key in item-info.ts's `result`
//       label: 'Genre',
//       barcodeLike: false,           // true for barcode/isbn/catalogNumber: always
//                                     // unchecked by default and shows a source next to it,
//                                     // regardless of whether the current value is empty
//       getCurrent: () => el.value,
//       format: (raw) => String(raw), // optional — defaults to String(raw)
//       apply: (raw) => { el.value = raw },
//     }, ...],
//   })
//
// Loaded as a global, not an ES module — `<script is:inline src="/item-info-flow.js">`.

function aifHostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch (e) {
    return url
  }
}

window.createItemInfoFlow = function (config) {
  const { btn, msg, resultsWrap } = config.els

  function showMsg(text, ok) {
    msg.hidden = false
    msg.textContent = text
    msg.style.color = ok ? 'var(--muted)' : '#e74c3c'
  }
  function hideMsg() {
    msg.hidden = true
    msg.textContent = ''
  }

  function renderResults(result, sources) {
    resultsWrap.replaceChildren()

    const rows = []
    config.fields.forEach((f) => {
      const raw = result[f.key]
      if (raw == null || raw === '') return
      const current = (f.getCurrent() || '').toString().trim()
      rows.push({
        key: f.key,
        label: f.label,
        raw,
        current: current || '(empty)',
        suggested: f.format ? f.format(raw) : String(raw),
        checkedByDefault: f.barcodeLike ? false : !current,
        barcodeLike: !!f.barcodeLike,
        apply: f.apply,
      })
    })

    if (rows.length === 0) {
      resultsWrap.hidden = true
      showMsg('Nothing reliable found.', false)
      return
    }
    hideMsg()

    const card = document.createElement('div')
    card.className = 'aif-card'

    const list = document.createElement('ul')
    list.className = 'aif-list'
    rows.forEach((r) => {
      const li = document.createElement('li')
      li.className = 'aif-item'
      const label = document.createElement('label')
      label.className = 'aif-item-label'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'aif-checkbox'
      checkbox.dataset.key = r.key
      checkbox.checked = r.checkedByDefault
      const text = document.createElement('span')
      text.className = 'aif-item-text'
      const strong = document.createElement('strong')
      strong.textContent = r.label
      text.appendChild(strong)
      text.appendChild(document.createElement('br'))
      text.appendChild(document.createTextNode('Current: ' + r.current))
      text.appendChild(document.createElement('br'))
      let suggestedLine = 'Suggested: ' + r.suggested
      if (r.barcodeLike && sources.length > 0) suggestedLine += ' (source: ' + aifHostnameOf(sources[0].url) + ')'
      text.appendChild(document.createTextNode(suggestedLine))
      label.appendChild(checkbox)
      label.appendChild(text)
      li.appendChild(label)
      list.appendChild(li)
    })
    card.appendChild(list)

    const applyBtn = document.createElement('button')
    applyBtn.type = 'button'
    applyBtn.className = 'aif-apply-btn'
    applyBtn.textContent = 'Apply selected'
    applyBtn.addEventListener('click', () => {
      list.querySelectorAll('.aif-checkbox').forEach((cb) => {
        if (!cb.checked) return
        const r = rows.find((x) => x.key === cb.dataset.key)
        if (r) r.apply(r.raw)
      })
      showMsg('Applied — review and press Save to keep it.', true)
      resultsWrap.hidden = true
    })
    card.appendChild(applyBtn)

    if (sources.length > 0) {
      const sourcesP = document.createElement('p')
      sourcesP.className = 'aif-sources'
      sourcesP.appendChild(document.createTextNode('Sources: '))
      sources.forEach((s, i) => {
        const a = document.createElement('a')
        a.className = 'aif-source-link'
        a.href = s.url
        a.target = '_blank'
        a.rel = 'noopener'
        a.textContent = s.title || s.url
        sourcesP.appendChild(a)
        if (i < sources.length - 1) sourcesP.appendChild(document.createTextNode(' · '))
      })
      card.appendChild(sourcesP)
    }

    resultsWrap.appendChild(card)
    resultsWrap.hidden = false
  }

  async function fillFromWeb() {
    const query = config.getQuery()
    if (!query.title) {
      showMsg('Enter a title first.', false)
      return
    }
    resultsWrap.hidden = true
    resultsWrap.replaceChildren()
    hideMsg()
    btn.disabled = true
    btn.textContent = 'Looking…'
    try {
      const res = await fetch('/api/item-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: config.type, ...query }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        showMsg((data && data.error) || 'Lookup failed.', false)
        return
      }
      renderResults(data.result || {}, data.sources || [])
    } catch (e) {
      showMsg('Network error.', false)
    } finally {
      btn.disabled = false
      btn.textContent = '✨ Fill in from web'
    }
  }
  btn.addEventListener('click', fillFromWeb)
}
