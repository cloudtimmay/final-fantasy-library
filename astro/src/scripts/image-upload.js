// Shared camera/gallery image upload for detail pages.
// Uploads to /api/upload-image and swaps the existing photo or placeholder for the new image.
// Used on albums, games, books and merchandise detail pages. The photo is first resized to
// the stored-photo size (resize-image.js defaults, max 1400 px) — before October 2026 these
// pages uploaded the camera original as-is (~5 MB for a 4000x3000 phone photo).
export function initImageUpload() {
  const camera = document.querySelector('#img-camera')
  const gallery = document.querySelector('#img-gallery')
  const uploadMsg = document.querySelector('#upload-msg')
  const photo = document.querySelector('.detail-photo, .detail-photo-placeholder')

  async function handleUpload(fileInput) {
    const file = fileInput.files && fileInput.files[0]
    if (!file) return

    uploadMsg.hidden = false
    uploadMsg.style.color = 'var(--muted)'
    uploadMsg.textContent = 'Uploading…'

    let chosen = file
    try {
      if (window.resizeImage) chosen = await window.resizeImage(file)
    } catch (e) { chosen = file }

    const form = new FormData()
    form.append('file', chosen)
    form.append('docId', window.location.pathname.split('/').pop())
    form.append('field', 'image')

    try {
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        uploadMsg.style.color = '#e74c3c'
        uploadMsg.textContent = data.error || 'Upload failed.'
        return
      }
      uploadMsg.style.color = '#2ecc71'
      uploadMsg.textContent = 'Uploaded ✓'
      if (photo && data.url) {
        const fresh = data.url + '?w=900&auto=format&t=' + Date.now()
        // Tap to enlarge (public/lightbox.js) at full size.
        const large = data.url + '?w=2000&fit=max&auto=format'
        if (photo.tagName === 'IMG') {
          photo.src = fresh
          photo.dataset.lightbox = large
        } else {
          const img = document.createElement('img')
          img.className = 'detail-photo'
          img.src = fresh
          img.dataset.lightbox = large
          img.alt = document.querySelector('h1')?.textContent || ''
          photo.replaceWith(img)
        }
      }
    } catch {
      uploadMsg.style.color = '#e74c3c'
      uploadMsg.textContent = 'Network error.'
    }
  }

  if (camera) camera.addEventListener('change', () => handleUpload(camera))
  if (gallery) gallery.addEventListener('change', () => handleUpload(gallery))
}
