// Route screenshots for /api/train-from-screenshot, kept readable. A phone screenshot is tall
// (about 1060×2376): shrunk to 1024 px on its long side, its small print became unreadable and
// only the first leg came back. So the width is kept (up to MAX_WIDTH) and a tall image is cut
// into overlapping parts, each small enough that the API reads it without shrinking it again
// (about 1.15 megapixels, at most 1568 px on a side), sent together as several images.
// `planScreenshotParts` is pure (tested); `screenshotParts` does it in the browser with a canvas.

export const MAX_WIDTH = 1200 // a wider image is scaled down to this
export const MIN_WIDTH = 720 // never smaller than this: below it the small print goes
export const MAX_PART_PIXELS = 1_150_000 // the API reads up to about this many pixels as they are
export const MAX_PART_SIDE = 1568 // … and up to this long a side
export const OVERLAP = 120 // each part repeats this much of the one before, so no row is cut in two
export const MAX_PARTS = 4 // per screenshot; a very long one is scaled down (not below MIN_WIDTH) to fit

export type ScreenshotPlan = { scale: number; width: number; height: number; parts: { top: number; height: number }[] }

// How to cut an image of `w`×`h` px: its scale and the parts (in the scaled image's pixels).
export function planScreenshotParts(w: number, h: number): ScreenshotPlan {
  let scale = w > MAX_WIDTH ? MAX_WIDTH / w : 1
  const partsFor = (s: number) => {
    const width = Math.round(w * s), height = Math.round(h * s)
    const partH = Math.max(OVERLAP * 2, Math.min(MAX_PART_SIDE, Math.floor(MAX_PART_PIXELS / width)))
    const n = height <= partH ? 1 : Math.ceil((height - OVERLAP) / (partH - OVERLAP))
    return { width, height, partH, n }
  }
  let p = partsFor(scale)
  // Too many parts: smaller, but never below MIN_WIDTH (then more parts instead).
  while (p.n > MAX_PARTS && w * scale * 0.9 >= MIN_WIDTH) { scale *= 0.9; p = partsFor(scale) }
  const parts: { top: number; height: number }[] = []
  if (p.n === 1) parts.push({ top: 0, height: p.height })
  else {
    // Evenly spread, the last one ending at the bottom; each overlapping the one before.
    const step = (p.height - p.partH) / (p.n - 1)
    for (let i = 0; i < p.n; i++) parts.push({ top: Math.round(i * step), height: p.partH })
  }
  return { scale, width: p.width, height: p.height, parts }
}

// In the browser: the screenshot as JPEG parts (base64, no "data:" prefix), per the plan.
export async function screenshotParts(file: File, quality = 0.85): Promise<string[]> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Not an image'))
      i.src = url
    })
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
    const plan = planScreenshotParts(w, h)
    return plan.parts.map((part) => {
      const canvas = document.createElement('canvas')
      canvas.width = plan.width
      canvas.height = part.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // The part of the source image (source pixels) drawn at the plan's scale.
      ctx.drawImage(img, 0, part.top / plan.scale, w, part.height / plan.scale, 0, 0, plan.width, part.height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      return dataUrl.slice(dataUrl.indexOf(',') + 1)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
