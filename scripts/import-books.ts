import { createClient } from "@sanity/client"

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

// Kilde 1: Open Library
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
      externalImageUrl: data.cover?.large || data.cover?.medium || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
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
      externalImageUrl: cover || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
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
  let skipped = 0
  let failed = 0

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
      console.log(`FANT IKKE: ${isbn} — legg inn manuelt i Studio`)
      failed++
      continue
    }

    const { source, ...fields } = info
    await client.create({
      _id: `book-isbn-${isbn}`,
      _type: "book",
      isbn,
      genre: "Game Guide",
      ...fields,
    })

    console.log(`Opprettet (${source}): ${info.title} (${isbn})`)
    created++
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log(`DONE — ${created} opprettet, ${skipped} hoppet over, ${failed} ikke funnet`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})