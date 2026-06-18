import { createClient } from "@sanity/client"
import puppeteer from "puppeteer"
import * as XLSX from "xlsx"

const INPUT_XLSX = "FFalbumList.xlsx"

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

function readUrlsFromExcel() {
  const workbook = XLSX.readFile(INPUT_XLSX)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" })

  return rows
    .map((row) => {
      const url = String(row[2] || "").trim() // kolonne C
      return {
        vgmdbId: getAlbumId(url),
        vgmdbUrl: url.replace("http://", "https://"),
      }
    })
    .filter((row) => row.vgmdbId && row.vgmdbUrl.includes("vgmdb.net/album/"))
}

async function main() {
  const albums = readUrlsFromExcel()
  console.log(`Found ${albums.length} album URLs from Excel column C`)

  const browser = await puppeteer.launch({
  headless: false,
  executablePath:
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  userDataDir:
    "C:\\Users\\User\\AppData\\Local\\Microsoft\\Edge\\User Data",
  args: [
    "--profile-directory=Default"
  ]
})

  const page = await browser.newPage()

  console.log("Browser opened.")
  console.log("Log in to VGMdb and complete Cloudflare if needed.")
  console.log("After the album page is visible, come back here and press ENTER.")

  await page.goto(albums[0].vgmdbUrl, { waitUntil: "domcontentloaded" })

  process.stdin.resume()
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve())
  })

  for (const album of albums) {
    console.log(`Scraping ${album.vgmdbId} - ${album.vgmdbUrl}`)

    await page.goto(album.vgmdbUrl, { waitUntil: "networkidle2", timeout: 60000 })
    await new Promise((resolve) => setTimeout(resolve, 1200))

    const blocked = await page.evaluate(() =>
      document.body.innerText.includes("Performing security verification")
    )

    if (blocked) {
      console.log("Cloudflare appeared again. Solve it in the browser, then press ENTER.")
      await new Promise<void>((resolve) => {
        process.stdin.once("data", () => resolve())
      })
    }

    const data = await page.evaluate(`
      (() => {
        function clean(text) {
          return (text || '').replace(/\\s+/g, ' ').trim()
        }

        function getInfo(label) {
          const rows = Array.from(document.querySelectorAll('tr'))
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'))
            if (cells.length < 2) continue
            const key = clean(cells[0].textContent)
            const value = clean(cells[1].textContent)
            if (key.toLowerCase() === label.toLowerCase()) return value
          }
          return ''
        }

        const tracklist = []
let currentDisc = 1

const tracklistText = document.body.innerText
const lines = tracklistText.split('\n').map(clean).filter(Boolean)

for (const line of lines) {
  const discMatch = line.match(/^Disc\s+(\d+)/i)

  if (discMatch) {
    currentDisc = Number(discMatch[1])
    continue
  }

  const trackMatch = line.match(/^(\d{1,3})\s+(.+)$/)

  if (!trackMatch) continue

  const trackNumber = trackMatch[1].padStart(2, '0')
  const title = trackMatch[2]

  tracklist.push({
    _key: `${currentDisc}-${trackNumber}-${title}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 80),
    disc: currentDisc,
    trackNumber,
    title,
  })
}

          const text = clean(row.textContent)
          const discMatch = text.match(/^Disc\\s+(\\d+)/i)
          if (discMatch) {
            currentDisc = Number(discMatch[1])
            continue
          }

          const cells = Array.from(row.querySelectorAll('td'))
          if (cells.length < 2) continue

          const first = clean(cells[0].textContent)
          const second = clean(cells[1].textContent)

          if (!/^\\d{1,3}$/.test(first)) continue
          if (!second) continue

          tracklist.push({
            _key: `${currentDisc}-${first}`,
            disc: currentDisc,
            trackNumber: first.padStart(2, "0"),
            title: second,
          })
        }

        return {
          catalogNumber: getInfo('Catalog Number'),
          barcode: getInfo('Barcode'),
          releaseDate: getInfo('Release Date'),
          releasePrice: getInfo('Release Price'),
          format: getInfo('Media Format'),
          label: getInfo('Label'),
          publisher: getInfo('Publisher'),
          distributor: getInfo('Distributor'),
          tracklist,
        }
      })()
    `)

    await client
      .patch(`album-vgmdb-${album.vgmdbId}`)
      .set({ ...data, vgmdbUrl: album.vgmdbUrl })
      .commit()

    console.log(`Updated ${album.vgmdbId}: ${data.tracklist.length} tracks`)
  }

  await browser.close()
  console.log("DONE")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})