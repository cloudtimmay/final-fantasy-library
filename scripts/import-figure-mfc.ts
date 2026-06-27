import { createClient } from "@sanity/client"
import puppeteer from "puppeteer"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

// Paste figure barcodes (JAN) here, one per line.
const BARCODES = [
  "4988601310307",
  "4988601311861",
  

]

function cleanCode(raw: string) {
  return raw.replace(/[^0-9Xx]/g, "")
}

async function main() {
  const codes = BARCODES.map(cleanCode).filter(Boolean)
  console.log(`Found ${codes.length} barcodes to look up`)

  if (codes.length === 0) {
    console.log("Ingenting å gjøre. Avslutter.")
    return
  }

  // Skip barcodes we already have a figure for.
  const existing: string[] = await client.fetch(`*[_type == "figure" && defined(barcode)].barcode`)
  const existingSet = new Set(existing.filter(Boolean))

  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    userDataDir:
      "C:\\Users\\User\\AppData\\Local\\Microsoft\\Edge\\User Data",
    args: ["--profile-directory=Default"],
  })

  const page = await browser.newPage()

  await page.setRequestInterception(true)
  page.on("request", (req) => {
    const type = req.resourceType()
    if (type === "media" || type === "font") {
      req.abort()
    } else {
      req.continue()
    }
  })

  console.log("Browser opened.")
  console.log("Log in to MyFigureCollection and complete Cloudflare if needed.")
  console.log("Open any MFC page so you're past Cloudflare, then come back and press ENTER.")

  await page.goto("https://myfigurecollection.net/", { waitUntil: "domcontentloaded" })

  process.stdin.resume()
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve())
  })

  let created = 0
  let skipped = 0
  const missing: string[] = []
  let done = 0

  for (const code of codes) {
    done++

    if (existingSet.has(code)) {
      console.log(`[${done}/${codes.length}] Hopper over (finnes): ${code}`)
      skipped++
      continue
    }

    console.log(`[${done}/${codes.length}] Søker ${code}`)

    // Step 1: search by barcode and see where MFC lands us.
    try {
      await page.goto(
        `https://myfigurecollection.net/?_tb=item&keywords=${encodeURIComponent(code)}`,
        { waitUntil: "domcontentloaded", timeout: 30000 }
      )
    } catch (e) {
      console.log(`  Timeout på søk for ${code}, hopper over`)
      missing.push(code)
      continue
    }

    await new Promise((r) => setTimeout(r, 800))

    const blocked = await page.evaluate(() =>
      document.body.innerText.includes("Performing security verification")
    )
    if (blocked) {
      console.log("  Cloudflare. Løs i nettleseren, trykk ENTER.")
      await new Promise<void>((resolve) => {
        process.stdin.once("data", () => resolve())
      })
    }

    // If the search didn't redirect straight to an item, try the first result link.
    let itemUrl = page.url()
    if (!/\/item\/\d+/.test(itemUrl)) {
      const firstItem = await page.evaluate(() => {
        const a = document.querySelector('a[href*="/item/"]') as HTMLAnchorElement | null
        return a ? a.href : ""
      })
      if (firstItem) {
        await page.goto(firstItem, { waitUntil: "domcontentloaded", timeout: 30000 })
        await new Promise((r) => setTimeout(r, 600))
        itemUrl = page.url()
      }
    }

    if (!/\/item\/\d+/.test(itemUrl)) {
      console.log(`  Fant ingen item-side for ${code}`)
      missing.push(code)
      continue
    }

    // Step 2: scrape the item page.
    const data = await page.evaluate(`
      (() => {
        function clean(text) {
          return (text || '').replace(/\\s+/g, ' ').trim()
        }

        // Title from og:title, stripped of the site suffix.
        function getTitle() {
          const m = document.querySelector('meta[property="og:title"]')
          let t = m ? m.getAttribute('content') : ''
          return clean((t || '').replace(/\\s*—\\s*MyFigureCollection.*$/i, ''))
        }

        function getImage() {
          const m = document.querySelector('meta[property="og:image"]')
          return m ? (m.getAttribute('content') || '') : ''
        }

        // Find a .data-value by its sibling .data-label text.
        function getField(label) {
          const fields = Array.from(document.querySelectorAll('.data-field'))
          for (const f of fields) {
            const labelEl = f.querySelector('.data-label')
            const valueEl = f.querySelector('.data-value')
            if (!labelEl || !valueEl) continue
            if (clean(labelEl.textContent).toLowerCase() === label.toLowerCase()) {
              return valueEl
            }
          }
          return null
        }

        // Series = Origin. Read the entry name (handles the dual JP/EN span).
        function getSeries() {
          const v = getField('Origin')
          if (!v) return ''
          const entry = v.querySelector('.item-entry span[switch], .item-entry span')
          return clean(entry ? entry.textContent : v.textContent)
        }

        // Manufacturer = Companies. May be several, comma-joined.
        function getManufacturer() {
          const v = getField('Companies')
          if (!v) return ''
          const names = Array.from(v.querySelectorAll('.item-entry span[switch], .item-entry span'))
            .map((el) => clean(el.textContent))
            .filter(Boolean)
          // De-dupe while preserving order.
          const seen = []
          for (const n of names) if (!seen.includes(n)) seen.push(n)
          return seen.join(', ')
        }

        // Year from the Releases field (e.g. "04/2008").
        function getYear() {
          const v = getField('Releases')
          const text = v ? clean(v.textContent) : clean(document.body.innerText)
          const m = text.match(/(20|19)\\d{2}/)
          return m ? Number(m[0]) : 0
        }

        return {
          title: getTitle(),
          series: getSeries(),
          manufacturer: getManufacturer(),
          year: getYear(),
          externalImageUrl: getImage(),
        }
      })()
    `)

    if (!data.title) {
      console.log(`  Klarte ikke parse ${code} (${itemUrl})`)
      missing.push(code)
      continue
    }

    const doc: any = {
      _id: `figure-jan-${code}`,
      _type: "figure",
      barcode: code,
      title: data.title,
      needsInfo: false,
    }
    if (data.series) doc.series = data.series
    if (data.manufacturer) doc.manufacturer = data.manufacturer
    if (data.year) doc.year = data.year
    if (data.externalImageUrl) doc.externalImageUrl = data.externalImageUrl

    await client.create(doc)
    console.log(`  Opprettet: ${data.title} (serie: ${data.series || "-"}, ${data.year || "-"})`)
    created++

    await new Promise((r) => setTimeout(r, 500))
  }

  await browser.close()

  console.log(`\nDONE — ${created} opprettet, ${skipped} hoppet over`)
  if (missing.length > 0) {
    console.log(`\n=== Strekkoder uten treff (fyll inn manuelt) ===`)
    missing.forEach((c) => console.log(c))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})