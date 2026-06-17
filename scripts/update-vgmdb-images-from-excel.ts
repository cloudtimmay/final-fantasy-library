import { createClient } from "@sanity/client"
import puppeteer from "puppeteer"
import * as XLSX from "xlsx"

type AlbumRow = {
  vgmdbId: string
  vgmdbUrl: string
  externalImageUrl?: string
}

const INPUT_XLSX = process.argv[2] || "FFalbumList.xlsx"

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

function readAlbumRowsFromExcel(filePath: string): AlbumRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
  })

  const albums: AlbumRow[] = []

  for (const row of rows) {
    const url = String(row[2] || "").trim()
    const image = String(row[4] || "").trim()

    if (!url.includes("vgmdb.net/album/")) continue

    const vgmdbId = getAlbumId(url)
    if (!vgmdbId) continue

    albums.push({
      vgmdbId,
      vgmdbUrl: url.replace("http://", "https://"),
      externalImageUrl: image.startsWith("http") ? image : undefined,
    })
  }

  return albums
}

async function findImageWithBrowser(page: any, url: string) {
  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000,
  })

  await new Promise((resolve) => setTimeout(resolve, 1500))

  const imageUrl = await page.evaluate(`
    (() => {
      const cover = document.querySelector("#coverart");
      if (!cover) return null;

      const bg = window.getComputedStyle(cover).backgroundImage;
      const match = bg.match(/url\\(["']?(.*?)["']?\\)/);

      if (!match) return null;

      const imageUrl = match[1];

      if (!imageUrl || imageUrl.startsWith("data:")) return null;

      return imageUrl;
    })()
  `)

  return imageUrl as string | null
}

async function main() {
  console.log(`Reading: ${INPUT_XLSX}`)

  const albums = readAlbumRowsFromExcel(INPUT_XLSX)

  console.log(`Found ${albums.length} album URLs in Excel`)

  const browser = await puppeteer.launch({
    headless: true,
  })

  const page = await browser.newPage()

  for (const album of albums) {
    let imageUrl = album.externalImageUrl

    if (imageUrl) {
      console.log(`Using Excel image ${album.vgmdbId}`)
    } else {
      console.log(`Scraping ${album.vgmdbId} - ${album.vgmdbUrl}`)

      try {
        imageUrl = await findImageWithBrowser(page, album.vgmdbUrl)
      } catch (error) {
        console.log(`Failed to scrape ${album.vgmdbId}`)
        continue
      }
    }

    if (!imageUrl) {
      console.log(`No image found for ${album.vgmdbId}`)
      continue
    }

    await client
      .patch(`album-vgmdb-${album.vgmdbId}`)
      .set({
        externalImageUrl: imageUrl,
        vgmdbUrl: album.vgmdbUrl,
      })
      .commit()

    console.log(`Updated ${album.vgmdbId}: ${imageUrl}`)
  }

  await browser.close()

  console.log("DONE")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})