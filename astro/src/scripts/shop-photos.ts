// The "📷 Shop photos" section on /edit-store (shopNote.photos).
//
// A chosen photo is resized like /add-price's (public/resize-image.js: 1400 px, JPEG 0.8) and
// uploaded at once in the background, straight into the shop's photos (/api/upload-image,
// field "photos") — the page stays usable meanwhile, and nothing waits for "Save changes".
// Caption, ▲▼ and Remove go to /api/shop-photos by the photo's key. The item markup matches
// the server-rendered one in edit-store.astro (its "sp-" styles are global there).
import { cdnImage } from '../lib/image-url'

export function initShopPhotos() {
  const section = document.querySelector('#shop-photos') as HTMLElement | null
  if (!section) return
  const shopId = section.dataset.shopId!
  const list = section.querySelector('#sp-list') as HTMLUListElement
  const empty = section.querySelector('#sp-empty') as HTMLElement
  const camera = section.querySelector('#sp-camera') as HTMLInputElement
  const gallery = section.querySelector('#sp-gallery') as HTMLInputElement

  function status(item: HTMLElement, text: string, ok: boolean | null) {
    const el = item.querySelector('.sp-status') as HTMLElement
    el.hidden = !text
    el.textContent = text
    el.style.color = ok === null ? 'var(--muted)' : ok ? '#2ecc71' : '#e74c3c'
  }

  // ▲ off on the first photo, ▼ off on the last; caption and ▲▼ only once a photo has its key.
  function refresh() {
    const items = [...list.querySelectorAll<HTMLElement>('.sp-item')]
    items.forEach((item, i) => {
      const ready = !!item.dataset.key
      ;(item.querySelector('.sp-up') as HTMLButtonElement).disabled = !ready || i === 0
      ;(item.querySelector('.sp-down') as HTMLButtonElement).disabled = !ready || i === items.length - 1
      ;(item.querySelector('.sp-caption') as HTMLInputElement).disabled = !ready
    })
    empty.hidden = items.length > 0
  }

  function newItem(previewSrc: string): HTMLElement {
    const item = document.createElement('li')
    item.className = 'sp-item'
    item.innerHTML = `
      <img class="sp-img" alt="Shop photo" data-lightbox="" />
      <div class="sp-body">
        <input class="sp-caption" type="text" maxlength="100" placeholder="Caption, e.g. Floor guide" aria-label="Caption" />
        <div class="sp-actions">
          <button type="button" class="sp-up" aria-label="Move up">▲</button>
          <button type="button" class="sp-down" aria-label="Move down">▼</button>
          <button type="button" class="sp-remove">🗑️ Remove</button>
        </div>
        <p class="sp-status" hidden></p>
      </div>`
    ;(item.querySelector('.sp-img') as HTMLImageElement).src = previewSrc
    return item
  }

  async function addPhoto(file: File) {
    let chosen = file
    try {
      const resize = (window as any).resizeImage
      if (resize) chosen = await resize(file)
    } catch (e) { chosen = file }
    const preview = URL.createObjectURL(chosen)
    const item = newItem(preview)
    list.appendChild(item)
    refresh()
    status(item, 'Uploading…', null)
    const form = new FormData()
    form.append('file', chosen)
    form.append('docId', shopId)
    form.append('field', 'photos')
    try {
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.key) {
        status(item, data.error || 'Upload failed — remove it and try again.', false)
        return
      }
      item.dataset.key = data.key
      const img = item.querySelector('.sp-img') as HTMLImageElement
      if (data.url) {
        img.addEventListener('load', () => URL.revokeObjectURL(preview), { once: true })
        img.src = cdnImage(data.url, 240)
        img.dataset.lightbox = cdnImage(data.url, 2000)
      }
      status(item, 'Added ✓', true)
    } catch (e) {
      status(item, 'Network error — remove it and try again.', false)
    } finally {
      refresh()
    }
  }

  async function onFiles(input: HTMLInputElement) {
    const files = [...(input.files || [])]
    input.value = ''
    for (const file of files) await addPhoto(file)
  }
  camera.addEventListener('change', () => onFiles(camera))
  gallery.addEventListener('change', () => onFiles(gallery))

  async function send(item: HTMLElement, body: Record<string, unknown>): Promise<string[] | null> {
    try {
      const res = await fetch('/api/shop-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shopId, key: item.dataset.key, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { status(item, data.error || 'Not saved.', false); return null }
      return Array.isArray(data.keys) ? data.keys : []
    } catch (e) {
      status(item, 'Network error — not saved.', false)
      return null
    }
  }

  list.addEventListener('change', async (e) => {
    const input = (e.target as HTMLElement).closest('.sp-caption') as HTMLInputElement | null
    const item = input?.closest('.sp-item') as HTMLElement | null
    if (!input || !item?.dataset.key) return
    status(item, 'Saving…', null)
    if (await send(item, { action: 'caption', caption: input.value })) {
      ;(item.querySelector('.sp-img') as HTMLImageElement).alt = input.value.trim() || 'Shop photo'
      status(item, 'Saved ✓', true)
    }
  })

  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null
    const item = btn?.closest('.sp-item') as HTMLElement | null
    if (!btn || !item) return
    if (btn.classList.contains('sp-remove')) {
      if (!confirm('Remove this photo from the shop?')) return
      // One that never uploaded is only on this page.
      if (item.dataset.key && !(await send(item, { action: 'remove' }))) return
      item.remove()
      refresh()
      return
    }
    const dir = btn.classList.contains('sp-up') ? -1 : btn.classList.contains('sp-down') ? 1 : 0
    if (!dir || !item.dataset.key) return
    btn.disabled = true
    const keys = await send(item, { action: 'move', dir })
    if (keys) {
      // The server's order; photos still uploading stay at the end.
      const byKey = new Map([...list.querySelectorAll<HTMLElement>('.sp-item[data-key]')].map((el) => [el.dataset.key!, el]))
      const pending = [...list.querySelectorAll<HTMLElement>('.sp-item:not([data-key])')]
      keys.forEach((k) => { const el = byKey.get(k); if (el) list.appendChild(el) })
      pending.forEach((el) => list.appendChild(el))
      status(item, '', null)
    }
    refresh()
  })
}
