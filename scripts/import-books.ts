import { createClient } from "@sanity/client"
import { writeFileSync } from "fs"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

const ISBNS = [
  "9781646092369",
  "9781506715735",
  "9781908172983",
  "9781908172525",
  "9781908172167",
  "9781906064549",
  "9781903511497",
  "9784087792782",
  "9781903511534",
  "9781903511336",
  "9781903511107",
  "9780953711208",
  "9781566867146",
  "9780744010244",
  "9780744012996",
  "9781506715742",
  "9781646090839",
  "9781616551605",
  "9784757537712",
  "9784757537705",
  "9784757537699",
  "9780316401166",
  "9781421589572",
  "4947817246657",
  "9784636855135",
  "9781506708010",
  "9781506706627",
  "9781506706443",
  "9781101898048",
  "9782377840427",
  "9782377842735",
  "9791094723562",
  "9784757565418",
  "9781646090846",
  "9784797334982",
  "9784925075015",
  "9781506713526",
  "9781975382384",
  "9781975382391",
  "9781646092031",

]

function cleanIsbn(raw: string) {
  return raw.replace(/[^0-9Xx]/g, "")
}

function parsePages(data: any): number | undefined {
  if (data.number_of_pages) return data.number_of_pages
  if (data.pagination) {
    const m = String(data.pagination).match(/\d+/)
    if (m) return Number(m[0])
  }
  return undefined
}

async function fetchWithTimeout(url: string, ms = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function lookupOpenLibrary(isbn: string) {
  try {
    const json = await fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
    const data = json[`ISBN:${isbn}`]
    if (!data || !data.title) return null
    return {
      title: data.title,
      author: (data.authors || []).map((a: any) => a.name).join(", ") || "Unknown",
      year: data.publish_date ? Number((String(data.publish_date).match(/\d{4}/) || [])[0]) || undefined : undefined,
      publisher: (data.publishers || []).map((p: any) => p.name).join(", ") || "",
      pages: parsePages(data),
      externalImageUrl: data.cover?.large || data.cover?.medium || "",
      source: "OpenLibrary",
    }
  } catch (e) {
    console.log(`  (Open Library feilet for ${isbn}, prøver Google Books)`)
    return null
  }
}

async function lookupGoogleBooks(isbn: string) {
  try {
    const json = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
    if (!json.items || json.items.length === 0) return null
    const v = json.items[0].volumeInfo
    if (!v || !v.title) return null
    let cover = ""
    if (v.imageLinks) {
      cover = v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || ""
      cover = cover.replace("http://", "https://").replace("&edge=curl", "")
    }
    return {
      title: v.title + (v.subtitle ? ": " + v.subtitle : ""),
      author: (v.authors || []).join(", ") || "Unknown",
      year: v.publishedDate ? Number((String(v.publishedDate).match(/\d{4}/) || [])[0]) || undefined : undefined,
      publisher: v.publisher || "",
      pages: v.pageCount || undefined,
      externalImageUrl: cover || "",
      source: "GoogleBooks",
    }
  } catch (e) {
    console.log(`  (Google Books feilet for ${isbn})`)
    return null
  }
}

async function lookup(isbn: string) {
  const ol = await lookupOpenLibrary(isbn)
  if (ol) return ol
  const gb = await lookupGoogleBooks(isbn)
  if (gb) return gb
  return null
}

async function main() {
  const existing: string[] = await client.fetch(`*[_type == "book"].isbn`)
  const existingSet = new Set(existing.filter(Boolean))

  let created = 0
  let placeholders = 0
  let skipped = 0
  const missing: string[] = []

  for (const raw of ISBNS) {
    const isbn = cleanIsbn(raw)
    if (!isbn) continue

    if (existingSet.has(isbn)) {
      console.log(`Hopper over (finnes): ${isbn}`)
      skipped++
      continue
    }

    const info = await lookup(isbn)

    if (!info || !info.title) {
      await client.create({
        _id: `book-isbn-${isbn}`,
        _type: "book",
        isbn,
        title: `Ukjent bok (${isbn})`,
        author: "Ukjent",
        genre: "Game Guide",
        needsInfo: true,
      })
      console.log(`PLASSHOLDER opprettet (mangler info): ${isbn}`)
      missing.push(isbn)
      placeholders++
      await new Promise((r) => setTimeout(r, 300))
      continue
    }

    const { source, ...fields } = info
    await client.create({
      _id: `book-isbn-${isbn}`,
      _type: "book",
      isbn,
      genre: "Game Guide",
      needsInfo: false,
      ...fields,
    })

    console.log(`Opprettet (${source}): ${info.title} (${isbn})`)
    created++
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log(`\nDONE — ${created} med data, ${placeholders} plassholdere, ${skipped} hoppet over`)

  if (missing.length > 0) {
    console.log(`\n=== ISBN-er som må fylles inn manuelt ===`)
    missing.forEach((isbn) => console.log(isbn))
    writeFileSync("missing-isbns.txt", missing.join("\n") + "\n")
    console.log(`\nSkrevet til scripts/missing-isbns.txt`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})