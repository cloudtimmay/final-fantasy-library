// Shrinks an image file in the browser before preview/upload to avoid memory spikes.
// Falls back to the original file on any error. Global: window.resizeImage(file, maxDim, quality) -> Promise<File>
window.resizeImage = function (file, maxDim, quality) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(file)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height
        const max = maxDim || 1600
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
        }, 'image/jpeg', quality || 0.85)
      } catch (e) {
        URL.revokeObjectURL(url)
        resolve(file)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}