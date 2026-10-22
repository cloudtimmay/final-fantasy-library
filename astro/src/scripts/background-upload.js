// Uploads a product photo as soon as it's chosen, as a standalone Sanity image asset (no
// document yet) via /api/upload-image without a docId, so Save only has to reference the
// returned asset id (imageAssetId) instead of waiting for the upload. Measured October
// 2026 on emulated 4G: the upload was ~6 s of an ~8 s Save.
//
// Used by /add-price, /add-item and /edit-product:
//   const bg = createBackgroundUpload()
//   bg.start(file)      — a photo was chosen (replaces any earlier one)
//   bg.discard()        — the photo was removed/replaced before saving: forget its upload
//   await bg.ensure()   — at Save: { assetId, url } (waits if still uploading, retries
//                         once if the background upload failed) or null if there's no
//                         photo or the retry failed too
//   bg.peek()           — { assetId, url } if already uploaded, else null (no waiting)

async function uploadAsset(file) {
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload-image', { method: 'POST', body: form })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return data && data.assetId ? { assetId: data.assetId, url: data.url || null } : null
  } catch (e) {
    return null
  }
}

export function createBackgroundUpload() {
  let job = null // { file, promise, result }

  function start(file) {
    if (!file) { job = null; return }
    const current = { file, result: null }
    current.promise = uploadAsset(file).then((result) => { current.result = result; return result })
    job = current
  }

  function discard() {
    job = null
  }

  async function ensure() {
    const current = job
    if (!current) return null
    let result = await current.promise
    if (!result && job === current) {
      // The background upload failed (network, server) — one more try now, at Save.
      current.promise = uploadAsset(current.file).then((r) => { current.result = r; return r })
      result = await current.promise
    }
    // Removed while waiting: no photo. Replaced while waiting: wait for the new one instead.
    if (job === current) return result
    return job ? ensure() : null
  }

  function peek() {
    return job && job.result ? job.result : null
  }

  return { start, discard, ensure, peek }
}
