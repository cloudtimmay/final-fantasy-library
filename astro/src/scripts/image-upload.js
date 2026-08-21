// Shared camera/gallery image upload for detail pages.
// Uploads to /api/upload-image and swaps the existing photo or placeholder for the new image.
// Used on albums, games, books and merchandise detail pages.
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

    const form = new FormData()
    form.append('file', file)
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
        const fresh = data.url + '?t=' + Date.now()
        if (photo.tagName === 'IMG') {
          photo.src = fresh
        } else {
          const img = document.createElement('img')
          img.className = 'detail-photo'
          img.src = fresh
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
