import { createClient } from '@sanity/client'
import imageUrlBuilder from '@sanity/image-url'

export const sanity = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token: import.meta.env.SANITY_TOKEN,
})

// Write client — server-side only. Uses the Editor token, never sent to the browser.
export const sanityWrite = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token: import.meta.env.SANITY_WRITE_TOKEN,
})

const builder = imageUrlBuilder(sanity)

// auto('format'): the CDN sends WebP/AVIF to browsers that take them, instead of the stored
// JPEG. Callers add the size (.width()/.height()), so a thumbnail never loads the full photo.
export function urlFor(source: any) {
  return builder.image(source).auto('format')
}

// Re-usable GROQ query fragments
export const SHARED_FIELDS =
  `status, rating, tags, image, acquiredDate, purchasePrice, purchasePriceYen, notes`