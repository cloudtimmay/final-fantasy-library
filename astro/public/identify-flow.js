// Shared "photo -> AI identify -> suggestion card" flow, extracted from add-price.astro so
// add-item.astro (and any future page) can reuse it instead of copying it. Owns: photo
// capture (+resize via resize-image.js), up to two extra photos (identify-only, never
// uploaded to Sanity), the "✨ Identify" button and its call to /api/identify-product, and
// the resulting suggestion card. A host page supplies its own `onUseSuggestion` to turn a
// suggestion into its own fields, and optionally `findExisting` to offer linking to an
// already-logged item instead.
//
// Usage:
//   const flow = window.createIdentifyFlow({
//     els: { photoCamera, photoGallery, photoName, preview, photoRemoveBtn, identifyBtn,
//            identifyMsg, identifyCard,
//            // optional — omit all four to disable the extra-photos feature entirely
//            extraPhotoButtons, extraPhotoCamera, extraPhotoGallery, extraPhotosWrap },
//     categoryLabels: {...},                                // optional, see DEFAULT_IDENTIFY_CATEGORY_LABELS
//     findExisting: (result) => ({ label, onUse }) | null,   // optional
//     onUseSuggestion: (result) => { ... },                  // required
//     onPhotoChosen: () => { ... },                          // optional — a NEW photo was taken/picked
//     onPhotoRemoved: () => { ... },                         // optional — only fires for an externally-shown photo
//   })
//   flow.getSelectedPhoto() / flow.getExtraPhotos() / flow.reset() / flow.showExternalPhoto(url, label)
//
// Loaded as a global (like resize-image.js/barcode-scanner.js), not an ES module —
// `<script is:inline src="/identify-flow.js">`, after resize-image.js.

window.DEFAULT_IDENTIFY_CATEGORY_LABELS = { album: 'Album', game: 'Game', book: 'Book', figure: 'Merchandise', other: 'Other' }

window.createIdentifyFlow = function (config) {
  const els = config.els
  const categoryLabels = config.categoryLabels || window.DEFAULT_IDENTIFY_CATEGORY_LABELS
  const MAX_EXTRA_PHOTOS = 2
  const hasExtraPhotoUI = !!(els.extraPhotoButtons && els.extraPhotoCamera && els.extraPhotoGallery && els.extraPhotosWrap)

  let selectedPhoto = null
  let extraPhotos = [] // { file, url }[]
  let suggestionShown = false // true while an AI suggestion card is on screen
  let externalPhotoActive = false // true while showExternalPhoto() is displaying a non-module photo

  function revokeIfBlob() {
    if (els.preview.src && els.preview.src.indexOf('blob:') === 0) { try { URL.revokeObjectURL(els.preview.src) } catch (e) {} }
  }

  function hideIdentifyMsg() {
    els.identifyMsg.hidden = true
    els.identifyMsg.textContent = ''
  }
  function showIdentifyMsg(text, ok) {
    els.identifyMsg.hidden = false
    els.identifyMsg.textContent = text
    els.identifyMsg.style.color = ok ? '#2ecc71' : '#e74c3c'
  }
  function hideIdentifyCard() {
    els.identifyCard.hidden = true
    els.identifyCard.replaceChildren()
    suggestionShown = false
  }

  function renderExtraPhotos() {
    if (!hasExtraPhotoUI) return
    els.extraPhotosWrap.replaceChildren()
    extraPhotos.forEach((p, idx) => {
      const item = document.createElement('div')
      item.className = 'idf-extra-photo-item'
      const img = document.createElement('img')
      img.className = 'idf-extra-photo-thumb'
      img.src = p.url
      img.alt = 'Extra photo ' + (idx + 1)
      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className = 'idf-extra-photo-remove'
      removeBtn.textContent = '✕'
      removeBtn.addEventListener('click', () => removeExtraPhoto(idx))
      item.appendChild(img)
      item.appendChild(removeBtn)
      els.extraPhotosWrap.appendChild(item)
    })
    els.extraPhotosWrap.hidden = extraPhotos.length === 0
    els.extraPhotoButtons.hidden = !selectedPhoto || extraPhotos.length >= MAX_EXTRA_PHOTOS
  }
  function addExtraPhoto(file) {
    if (!hasExtraPhotoUI || extraPhotos.length >= MAX_EXTRA_PHOTOS) return
    extraPhotos.push({ file, url: URL.createObjectURL(file) })
    renderExtraPhotos()
    // The suggestion card already on screen was built without this photo — nudge toward
    // re-running Identify rather than silently leaving it out.
    if (suggestionShown) showIdentifyMsg('New photo added. Tap Identify again to include it.', true)
  }
  function removeExtraPhoto(idx) {
    const [removed] = extraPhotos.splice(idx, 1)
    if (removed) { try { URL.revokeObjectURL(removed.url) } catch (e) {} }
    renderExtraPhotos()
  }
  function clearExtraPhotos() {
    extraPhotos.forEach((p) => { try { URL.revokeObjectURL(p.url) } catch (e) {} })
    extraPhotos = []
    renderExtraPhotos()
  }
  function handleExtraPhotoInput(input) {
    const file = input.files && input.files[0]
    input.value = ''
    if (file) addExtraPhoto(file)
  }
  if (hasExtraPhotoUI) {
    els.extraPhotoCamera.addEventListener('change', () => handleExtraPhotoInput(els.extraPhotoCamera))
    els.extraPhotoGallery.addEventListener('change', () => handleExtraPhotoInput(els.extraPhotoGallery))
  }

  function updatePhotoUI() {
    if (selectedPhoto) {
      els.preview.hidden = false
      els.photoRemoveBtn.hidden = false
      els.identifyBtn.hidden = false
      renderExtraPhotos()
      return
    }
    els.preview.hidden = true
    els.preview.src = ''
    els.photoName.hidden = true
    els.photoRemoveBtn.hidden = true
    els.identifyBtn.hidden = true
    renderExtraPhotos()
  }

  async function handlePhoto(fileInput) {
    const file = fileInput.files && fileInput.files[0]
    if (!file) return
    externalPhotoActive = false
    hideIdentifyMsg()
    hideIdentifyCard()
    clearExtraPhotos()
    els.photoName.hidden = false
    els.photoName.textContent = 'Processing photo…'
    let chosen = file
    try {
      if (window.resizeImage) chosen = await window.resizeImage(file, 1600, 0.85)
    } catch (e) { chosen = file }
    selectedPhoto = chosen
    revokeIfBlob()
    els.preview.src = URL.createObjectURL(chosen)
    els.photoName.textContent = file.name || 'photo'
    updatePhotoUI()
    fileInput.value = ''
    if (config.onPhotoChosen) config.onPhotoChosen()
  }
  els.photoCamera.addEventListener('change', () => handlePhoto(els.photoCamera))
  els.photoGallery.addEventListener('change', () => handlePhoto(els.photoGallery))

  function reset() {
    revokeIfBlob()
    selectedPhoto = null
    externalPhotoActive = false
    els.photoCamera.value = ''
    els.photoGallery.value = ''
    els.photoName.textContent = ''
    hideIdentifyMsg()
    hideIdentifyCard()
    clearExtraPhotos()
    updatePhotoUI()
  }
  els.photoRemoveBtn.addEventListener('click', () => {
    const wasExternal = externalPhotoActive
    reset()
    if (wasExternal && config.onPhotoRemoved) config.onPhotoRemoved()
  })

  // For a host that shows a photo it owns itself (e.g. add-price.astro's "reuse this
  // product's existing photo") in the same preview — Identify doesn't apply to it, and
  // removing it should notify the host (onPhotoRemoved) rather than just clearing nothing.
  function showExternalPhoto(url, label) {
    revokeIfBlob()
    selectedPhoto = null
    externalPhotoActive = true
    clearExtraPhotos()
    hideIdentifyMsg()
    hideIdentifyCard()
    els.preview.src = url
    els.preview.hidden = false
    els.photoName.hidden = false
    els.photoName.textContent = label || 'Using existing photo'
    els.photoRemoveBtn.hidden = false
    els.identifyBtn.hidden = true
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result || ''
        const commaIdx = result.indexOf(',')
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  function renderIdentifyCard(result) {
    els.identifyCard.replaceChildren()

    const title = document.createElement('div')
    title.className = 'idf-identify-title'
    title.textContent = '✨ AI suggestion'
    els.identifyCard.appendChild(title)

    function addRow(label, value) {
      if (value == null || value === '') return
      const row = document.createElement('div')
      row.className = 'idf-identify-row'
      const l = document.createElement('span')
      l.className = 'idf-identify-label'
      l.textContent = label
      const v = document.createElement('span')
      v.className = 'idf-identify-value'
      v.textContent = value
      row.appendChild(l)
      row.appendChild(v)
      els.identifyCard.appendChild(row)
    }

    addRow('Name', result.productName)
    addRow('Japanese', result.productNameJp)
    addRow('JAN', result.jan)
    addRow('Category', result.category ? (categoryLabels[result.category] || result.category) : null)
    if (typeof result.price === 'number') {
      // Shown in the currency read off the tag; no symbol when the tag didn't show one.
      const amount = result.price.toLocaleString('en-US')
      const priceText = result.currency === 'JPY' ? '¥' + amount : result.currency === 'NOK' ? amount + ' kr' : amount
      const taxText = result.taxIncluded === true ? 'tax included' : result.taxIncluded === false ? 'tax excluded' : ''
      addRow('Price', priceText + (taxText ? ' (' + taxText + ')' : ''))
    }

    if (result.confidence) {
      const conf = document.createElement('div')
      conf.className = 'idf-identify-confidence idf-identify-confidence-' + result.confidence
      conf.textContent = 'Confidence: ' + result.confidence
      els.identifyCard.appendChild(conf)
      if (result.confidence === 'low') {
        const warn = document.createElement('div')
        warn.className = 'idf-identify-warning'
        warn.textContent = '⚠️ Low confidence — double-check before using.'
        els.identifyCard.appendChild(warn)
      }
    }

    if (result.notes) {
      const notes = document.createElement('div')
      notes.className = 'idf-identify-notes'
      notes.textContent = result.notes
      els.identifyCard.appendChild(notes)
    }

    const actions = document.createElement('div')
    actions.className = 'idf-identify-actions'

    const existing = config.findExisting ? config.findExisting(result) : null

    const useBtn = document.createElement('button')
    useBtn.type = 'button'
    useBtn.className = 'idf-identify-use-btn'
    if (existing) {
      useBtn.textContent = existing.label
      useBtn.addEventListener('click', () => {
        existing.onUse()
        hideIdentifyCard()
      })
    } else {
      useBtn.textContent = 'Use suggestion'
      useBtn.addEventListener('click', () => {
        config.onUseSuggestion(result)
        hideIdentifyCard()
      })
    }

    const dismissBtn = document.createElement('button')
    dismissBtn.type = 'button'
    dismissBtn.className = 'idf-identify-dismiss-btn'
    dismissBtn.textContent = 'Dismiss'
    dismissBtn.addEventListener('click', hideIdentifyCard)

    actions.appendChild(useBtn)
    actions.appendChild(dismissBtn)
    els.identifyCard.appendChild(actions)

    els.identifyCard.hidden = false
    suggestionShown = true
  }

  async function identifyPhoto() {
    if (!selectedPhoto) return
    hideIdentifyCard()
    hideIdentifyMsg()
    els.identifyBtn.disabled = true
    els.identifyBtn.textContent = 'Identifying…'
    try {
      // Downscale further just for the API call — the photos already selected for
      // upload/saving (or kept only for identify) are untouched. The main photo always
      // goes first; extra photos are additional angles of the same item.
      const allPhotos = [selectedPhoto, ...extraPhotos.map((p) => p.file)]
      const images = []
      for (const photo of allPhotos) {
        let forApi = photo
        try {
          if (window.resizeImage) forApi = await window.resizeImage(photo, 1024, 0.8)
        } catch (e) {}
        images.push(await fileToBase64(forApi))
      }
      const res = await fetch('/api/identify-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        showIdentifyMsg((data && data.error) || 'Identification failed.', false)
        return
      }
      if (!data.result || Object.keys(data.result).length === 0) {
        showIdentifyMsg('Could not identify anything useful in this photo.', false)
        return
      }
      renderIdentifyCard(data.result)
    } catch (e) {
      showIdentifyMsg('Network error.', false)
    } finally {
      els.identifyBtn.disabled = false
      els.identifyBtn.textContent = '✨ Identify'
    }
  }
  els.identifyBtn.addEventListener('click', identifyPhoto)

  updatePhotoUI()

  return {
    getSelectedPhoto: () => selectedPhoto,
    getExtraPhotos: () => extraPhotos.map((p) => p.file),
    reset,
    showExternalPhoto,
  }
}
