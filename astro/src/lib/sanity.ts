import { createClient } from '@sanity/client'
import imageUrlBuilder from '@sanity/image-url'

console.log('SANITY ENV:', import.meta.env.SANITY_PROJECT_ID, import.meta.env.SANITY_DATASET, import.meta.env.SANITY_TOKEN ? 'token-finnes' : 'token-mangler')

export const sanity = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET ?? 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token: import.meta.env.SANITY_TOKEN,
})

const builder = imageUrlBuilder(sanity)

export function urlFor(source: any) {
  return builder.image(source)
}

// Re-usable GROQ query fragments
export const SHARED_FIELDS =
  `status, rating, tags, image, acquiredDate, purchasePrice, notes`
