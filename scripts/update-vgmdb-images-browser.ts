import { createClient } from "@sanity/client"
import puppeteer from "puppeteer"

console.log("SCRIPT STARTED")

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

async function main() {
  console.log("MAIN STARTED")

  const albums = await client.fetch(`
    *[_type == "album" && defined(vgmdbId)]{
      _id, title, vgmdbId, vgmdbUrl
    }
  `)

  console.log(`Found ${albums.length} albums`)

  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()

  for (const album of albums) {
    const url = album.vgmdbUrl || `https://vgmdb.net/album/${album.vgmdbId}`
    console.log(`Checking ${album.title}`)

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })

    const imageUrl = await page.evaluate(() => {
      const cover = document.querySelector("#coverart") as HTMLElement | null
      if (!cover) return null

      const bg = getComputedStyle(cover).backgroundImage
      const match = bg.match(/url\(["']?(.*?)["']?\)/)
      return match ? match[1] : null
    })

    if (!imageUrl || imageUrl.startsWith("data:")) {
      console.log(`No image found`)
      continue
    }

    await client.patch(album._id).set({ externalImageUrl: imageUrl }).commit()
    console.log(`Updated: ${imageUrl}`)
  }

  await browser.close()
}

main().catch(console.error)