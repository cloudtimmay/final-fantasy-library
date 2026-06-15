import { createClient } from '@sanity/client'
import imageUrlBuilder from '@sanity/image-url'

export const sanity = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? 'production',
  token: import.meta.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: '2024-01-01',
})

const builder = imageUrlBuilder(sanity)

export function urlFor(source: any) {
  return builder.image(source)
}

// Re-usable GROQ query fragments
export const SHARED_FIELDS =
  `status, rating, tags, image, acquiredDate, purchasePrice, notes`
