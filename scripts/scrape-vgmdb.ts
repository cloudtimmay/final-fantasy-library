import { createClient } from "@sanity/client"
import puppeteer from "puppeteer"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

async function getAlbumsFromSanity() {
  // Hent album som mangler cover (externalImageUrl) og har en VGMdb-URL.
  // Bytt filteret om du vil scrape alt: fjern "&& !defined(externalImageUrl)"
  const albums = await client.fetch(`
    *[_type == "album" && defined(vgmdbUrl) && !defined(externalImageUrl) && !(_id in path("drafts.**"))] {
      _id, vgmdbId, vgmdbUrl
    }
  `)
  return albums.filter((a: any) => a.vgmdbId && a.vgmdbUrl)
}

async function main() {
 console.log("Starter scraper...")
  const albums = await getAlbumsFromSanity()
  console.log(`Found ${albums.length} albums in Sanity missing cover`)

  if (albums.length === 0) {
    console.log("Ingenting å gjøre. Avslutter.")
    return
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    userDataDir:
      "C:\\Users\\User\\AppData\\Local\\Microsoft\\Edge\\User Data",
    args: ["--profile-directory=Default"],
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

        function getCover() {
          const el = document.querySelector('#coverart')
          if (!el) return ''
          const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage || ''
          const m = bg.match(/url\\(['"]?(.*?)['"]?\\)/)
          return m ? m[1] : ''
        }

        const tracklist = []
        const allTables = Array.from(document.querySelectorAll('table.role'))
        const visibleTables = allTables.filter((t) => t.offsetParent !== null)
        const trackTables = visibleTables.length ? visibleTables : allTables

        trackTables.forEach((table, tableIndex) => {
          const disc = tableIndex + 1
          const rows = Array.from(table.querySelectorAll('tr.rolebit'))

          rows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll('td'))
            if (cells.length < 2) return

            const trackNumber = clean(cells[0].textContent).padStart(2, '0')
            const titleCell = row.querySelector('td[colspan="2"]') || cells[1]
            const title = clean(titleCell.textContent)
            const timeEl = row.querySelector('span.time')
            const duration = clean(timeEl ? timeEl.textContent : '')

            if (!trackNumber || !title) return

            tracklist.push({
              _key: (disc + '-' + trackNumber + '-' + title)
                .replace(/[^a-zA-Z0-9]/g, '')
                .slice(0, 80),
              disc,
              trackNumber,
              title,
              duration,
            })
          })
        })

        return {
          catalogNumber: getInfo('Catalog Number'),
          barcode: getInfo('Barcode'),
          releaseDate: getInfo('Release Date'),
          releasePrice: getInfo('Release Price'),
          format: getInfo('Media Format'),
          label: getInfo('Label'),
          publisher: getInfo('Publisher'),
          distributor: getInfo('Distributor'),
          externalImageUrl: getCover(),
          tracklist,
        }
      })()
    `)

    // Bygg patch-objekt, men ikke overskriv eksisterende cover med tom verdi
    const patch: any = { ...data, vgmdbUrl: album.vgmdbUrl }
    if (!patch.externalImageUrl) delete patch.externalImageUrl

    await client.patch(album._id).set(patch).commit()

    console.log(
      `Updated ${album.vgmdbId}: ${data.tracklist.length} tracks, cover: ${data.externalImageUrl ? "ja" : "nei"}`
    )
  }

  await browser.close()
  console.log("DONE")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})