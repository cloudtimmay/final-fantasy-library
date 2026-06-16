import fs from "fs"
import { createClient } from "@sanity/client"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

async function main() {
  const html = fs.readFileSync("scripts/vgmdb-collection.html", "utf8")

  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g
  const albums: any[] = []

  for (const match of html.matchAll(liRegex)) {
    const liHtml = match[1]

    const albumMatch = liHtml.match(/href="https?:\/\/vgmdb\.net\/album\/(\d+)"/)
    const titleMatch = liHtml.match(/<span class="albumtitle" lang="en"[^>]*>([\s\S]*?)<\/span>/)
    const catalogMatch = liHtml.match(/<span class="catalog[^"]*">([^<]+)<\/span>/)

    if (!albumMatch || !titleMatch) continue

    const vgmdbId = albumMatch[1]
    const title = decodeHtml(stripHtml(titleMatch[1]))
    const catalogNumber = catalogMatch ? decodeHtml(catalogMatch[1]) : ""

    albums.push({
      _type: "album",
      _id: `album-vgmdb-${vgmdbId}`,
      title,
      artist: "Various Artists",
      vgmdbId,
      vgmdbUrl: `https://vgmdb.net/album/${vgmdbId}`,
      catalogNumber,
      status: "owned",
    })
  }

  console.log(`Found ${albums.length} albums`)

  for (const album of albums) {
    await client.createOrReplace(album)
    console.log(`Imported: ${album.title}`)
  }
}

function decodeHtml(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, "").trim()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})