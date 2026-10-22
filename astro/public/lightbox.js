// Tap a product photo to see it full screen. Loaded on every page from Base.astro; styles
// are the global "lb-" rules there.
//
// Any <img data-lightbox> opens it — the attribute's value is the large image URL (a Sanity
// CDN URL at a large width with auto=format, see lib/image-url.ts cdnImage() and urlFor());
// empty means "use the image's own src" (e.g. a freshly chosen photo's blob: preview). One
// delegated listener, so images built later in JS (previews, uploads) work too.
//
// A <dialog> over the page: pinch zoom is left to the browser; closes with the ✕ button,
// a tap outside the image, Escape, or the back button (an extra history entry is pushed
// while it's open, so "back" closes the photo instead of leaving the page).
;(function () {
  let dialog = null
  let img = null
  let pushedState = false

  function build() {
    dialog = document.createElement('dialog')
    dialog.className = 'lb-dialog'
    dialog.setAttribute('aria-label', 'Photo')
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'lb-close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '✕'
    img = document.createElement('img')
    img.className = 'lb-img'
    img.alt = ''
    dialog.appendChild(img)
    dialog.appendChild(close)
    document.body.appendChild(dialog)

    close.addEventListener('click', () => closeLightbox())
    // A tap anywhere but the photo itself (the dimmed area around it) closes it.
    dialog.addEventListener('click', (e) => { if (e.target !== img) closeLightbox() })
    // Escape fires "cancel" on a modal dialog; close through the same path so the extra
    // history entry is taken back too.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeLightbox() })
    window.addEventListener('popstate', () => {
      if (dialog.open) { pushedState = false; closeLightbox() }
    })
  }

  function openLightbox(src, alt) {
    if (!src) return
    if (!dialog) build()
    img.src = src
    img.alt = alt || ''
    if (!dialog.open) {
      dialog.showModal()
      try { history.pushState({ lightbox: true }, ''); pushedState = true } catch (e) { pushedState = false }
    }
  }

  function closeLightbox() {
    if (!dialog || !dialog.open) return
    dialog.close()
    img.removeAttribute('src')
    // Closed some other way than "back": remove the history entry opening it added.
    if (pushedState) { pushedState = false; history.back() }
  }

  // Capture phase: a photo inside a link or a clickable row opens the photo instead of
  // following the link / toggling the row.
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('img[data-lightbox]') : null
    if (!target || (dialog && dialog.contains(target))) return
    e.preventDefault()
    e.stopPropagation()
    openLightbox(target.getAttribute('data-lightbox') || target.currentSrc || target.src, target.alt)
  }, true)

  window.openLightbox = openLightbox
  window.closeLightbox = closeLightbox
})()
