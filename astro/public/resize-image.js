// Shrinks an image file in the browser before preview/upload to avoid memory spikes.
// Falls back to the original file on any error. Global: window.resizeImage(file, maxDim, quality) -> Promise<File>
//
// Defaults (no maxDim/quality) are the size every stored product photo uses: max 1400 px,
// JPEG quality 0.8. Measured October 2026 with a 4000x3000 phone photo: the previous 1600 px
// at 0.85 gave a 554 KB upload (~3 s on 4G) for an image only ever shown at up to ~1170
// physical px (a phone screen, in the lightbox) — 1400 px still covers that. The AI calls
// (identify-product, find-prices) use their own, smaller size: 1024 px at 0.8.
window.PHOTO_MAX_DIM = 1400
window.PHOTO_QUALITY = 0.8
window.resizeImage = function (file, maxDim, quality) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(file)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height
        const max = maxDim || window.PHOTO_MAX_DIM
        if (w > max || h > max) {
          if (w >= h) { h = Math.round(h * max / w); w = max }
          else { w = Math.round(w * max / h); h = max }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        canvas.toBlob((blob) => {
          if (!blob) return resolve(file)
          const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
          resolve(new File([blob], name, { type: 'image/jpeg' }))
        }, 'image/jpeg', quality || window.PHOTO_QUALITY)
      } catch (e) {
        URL.revokeObjectURL(url)
        resolve(file)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}