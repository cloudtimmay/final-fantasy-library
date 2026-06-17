import { createClient } from "@sanity/client"

console.log("SCRIPT STARTED")

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

async function main() {
  const albums = await client.fetch(`
    *[_type == "album" && defined(vgmdbId)]{
      _id,
      title,
      vgmdbId,
      vgmdbUrl
    }
  `)
    console.log("Project:", process.env.SANITY_PROJECT_ID)
    console.log("Dataset:", process.env.SANITY_DATASET)

    console.log(`Found ${albums.length} albums in Sanity`)

  for (const album of albums) {
    const url = album.vgmdbUrl || `https://vgmdb.net/album/${album.vgmdbId}`

    try {
      console.log(`Checking ${album.title} - ${url}`)

      const res = await fetch(url, {
      headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
  },
})
      const html = await res.text()

    
      const imageUrl = findImageUrl(html)

      if (!imageUrl) {
        console.log(`No image found for ${album.title}`)
        continue
      }

      await client
  .patch(album._id)
  .set({ externalImageUrl: imageUrl })
  .commit()

      console.log(`Updated image: ${imageUrl}`)

      } catch (err) {
      console.error(`Failed: ${album.title}`, err)
    }
  }
}

function findImageUrl(html: string) {
  const mediaMatch = html.match(
    /https?:\/\/(?:medium-media|media)\.vgm\.io\/albums\/[^"'<>\s)]+?\.(?:jpg|jpeg|png|webp)/i
  )

  if (mediaMatch) return mediaMatch[0]

  const backgroundMatch = html.match(
    /background-image:\s*url\(["']?(https?:\/\/(?:medium-media|media)\.vgm\.io\/albums\/[^"')]+)["']?\)/i
  )

  if (backgroundMatch) return backgroundMatch[1]

  return null
}

main()
  .then(() => console.log("DONE"))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })