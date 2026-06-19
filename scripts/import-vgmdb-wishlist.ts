import { createClient } from "@sanity/client"
import * as fs from "fs"

const INPUT_HTML = "scripts/vgmdb-wishlist.html"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

function getAlbumId(url: string) {
  return url.match(/album\/(\d+)/)?.[1] || ""
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&star;/g, "★")
    .trim()
}

function parseWishlist(html: string) {
  const albums: { vgmdbId: string; vgmdbUrl: string; title: string; catalogNumber: string }[] = []

  // Hver rad har <a class="albumtitle ..." href="...album/ID" title="...">
  const rowRegex = /<tr>[\s\S]*?<\/tr>/g
  const rows = html.match(rowRegex) || []

  for (const row of rows) {
    const linkMatch = row.match(/<a class="albumtitle[^"]*" href="([^"]+)"/)
    if (!linkMatch) continue

    const url = linkMatch[1].replace("http://", "https://")
    const vgmdbId = getAlbumId(url)
    if (!vgmdbId) continue

    // Engelsk tittel: <span class="albumtitle" lang="en" ...>TITLE</span>
    const titleMatch = row.match(/<span class="albumtitle" lang="en"[^>]*>([\s\S]*?)<\/span>/)
    const title = titleMatch ? decodeEntities(titleMatch[1]) : ""

    // Katalognummer: <span class="catalog ...">CAT</span>
    const catMatch = row.match(/<span class="catalog[^"]*">([\s\S]*?)<\/span>/)
    let catalogNumber = catMatch ? decodeEntities(catMatch[1]) : ""
    if (catalogNumber.toUpperCase() === "N/A") catalogNumber = ""

    if (title) {
      albums.push({ vgmdbId, vgmdbUrl: url, title, catalogNumber })
    }
  }

  return albums
}

async function main() {
  const html = fs.readFileSync(INPUT_HTML, "utf8")
  const albums = parseWishlist(html)
  console.log("Token finnes:", !!process.env.SANITY_TOKEN)
  console.log("HTML lengde:", html.length)
  console.log(`Found ${albums.length} albums in wishlist`)

  // Hent eksisterende album-IDer slik at vi ikke overskriver eide album
  const existingIds: string[] = await client.fetch(
    `*[_type == "album"]._id`
  )
  const existing = new Set(existingIds)

  let created = 0
  let skipped = 0

  for (const album of albums) {
    const _id = `album-vgmdb-${album.vgmdbId}`

    if (existing.has(_id) || existing.has(`drafts.${_id}`)) {
      console.log(`Skipper (finnes allerede): ${album.title}`)
      skipped++
      continue
    }

    await client.create({
      _id,
      _type: "album",
      title: album.title,
      artist: "Various Artists",
      vgmdbId: album.vgmdbId,
      vgmdbUrl: album.vgmdbUrl,
      catalogNumber: album.catalogNumber,
      status: "wishlist",
    })

    console.log(`Wishlist opprettet: ${album.title}`)
    created++
  }

  console.log(`DONE — ${created} opprettet, ${skipped} hoppet over (fantes fra før)`)
}
main().catch((err) => {
  console.error(err)
  process.exit(1)
})