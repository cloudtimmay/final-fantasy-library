import { createClient } from "@sanity/client"
import { writeFileSync } from "fs"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

const BARCODES = [
  "3546430024843",
  "662248999043",
  "711719694328",
  "711719736820",
  "5060121825833",
]

function cleanCode(raw: string) {
  return raw.replace(/[^0-9Xx]/g, "")
}

// Gjenkjenner plattform fra tittelteksten. Lengste/mest spesifikke først.
function guessPlatform(title: string): string | null {
  // Normaliser: "play station" / "play-station" -> "playstation"
  const t = title
    .toLowerCase()
    .replace(/play[\s-]*station/g, "playstation")
    .replace(/game[\s-]*cube/g, "gamecube")

  const rules: [RegExp, string][] = [
    [/\bwii\s*u\b/, "WIIU"],
    [/\bwii\b/, "WII"],
    [/\bgamecube\b|\bngc\b/, "GAMECUBE"],
    [/\bswitch\s*2\b/, "SWITCH2"],
    [/\bswitch\b/, "SWITCH"],
    [/\b3ds\b/, "3DS"],
    [/\bnintendo ds\b|\bnds\b/, "DS"],
    [/\bplaystation\s*5\b|\bps\s*5\b/, "PS5"],
    [/\bplaystation\s*4\b|\bps\s*4\b/, "PS4"],
    [/\bplaystation\s*3\b|\bps\s*3\b/, "PS3"],
    [/\bplaystation\s*2\b|\bps\s*2\b/, "PS2"],
    [/\bplaystation\s*vita\b|\bps\s*vita\b|\bpsvita\b|\bvita\b/, "PSVITA"],
    [/\bplaystation\s*portable\b|\bpsp\b/, "PSP"],
    [/\bplaystation\s*1\b|\bplaystation one\b|\bps\s*1\b|\bps\s*one\b|\bpsone\b|\bpsx\b/, "PS1"],
    [/\bplaystation\b/, "PS1"],
    [/\bxbox\b/, "XBOX"],
    [/\bsuper nintendo\b|\bsnes\b|\bsuper famicom\b/, "SNES"],
    [/\bnintendo entertainment system\b|\bnes\b|\bfamicom\b/, "NES"],
    [/\bpc\b|\bwindows\b/, "PC"],
  ]
  for (const [re, platform] of rules) {
    if (re.test(t)) return platform
  }
  if (/\bds\b/.test(t)) return "DS"
  return null
}

async function fetchWithTimeout(url: string, ms = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function lookupUPC(ean: string) {
  try {
    const json = await fetchWithTimeout(`https://api.upcitemdb.com/prod/trial/lookup?upc=${ean}`)
    if (json.code !== "OK" || !json.items || json.items.length === 0) return null
    const item = json.items[0]
    if (!item.title) return null
    return {
      title: item.title,
      externalImageUrl: (item.images && item.images[0]) || "",
      publisher: item.brand || "",
    }
  } catch (e) {
    console.log(`  (UPCitemdb feilet for ${ean})`)
    return null
  }
}

async function main() {
  const existing: string[] = await client.fetch(`*[_type == "game"].barcode`)
  const existingSet = new Set(existing.filter(Boolean))

  let created = 0
  let placeholders = 0
  let skipped = 0
  const missing: string[] = []

  for (const raw of BARCODES) {
    const ean = cleanCode(raw)
    if (!ean) continue

    if (existingSet.has(ean)) {
      console.log(`Hopper over (finnes): ${ean}`)
      skipped++
      continue
    }

    const info = await lookupUPC(ean)

    if (!info || !info.title) {
      await client.create({
        _id: `game-ean-${ean}`,
        _type: "game",
        barcode: ean,
        title: `Ukjent spill (${ean})`,
        needsInfo: true,
      })
      console.log(`PLASSHOLDER opprettet (mangler info): ${ean}`)
      missing.push(ean)
      placeholders++
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }

    const platform = guessPlatform(info.title)

    await client.create({
      _id: `game-ean-${ean}`,
      _type: "game",
      barcode: ean,
      // Alltid needsInfo=true her: tittel/plattform er gjettet fra UPCitemdb og bør sjekkes
      needsInfo: true,
      title: info.title,
      publisher: info.publisher || undefined,
      externalImageUrl: info.externalImageUrl || undefined,
      platform: platform ? [platform] : undefined,
    })

    console.log(`Opprettet: ${info.title} (${ean}) — plattform: ${platform || "?"}`)
    created++
    await new Promise((r) => setTimeout(r, 1500))
  }

  console.log(`\nDONE — ${created} med data, ${placeholders} plassholdere, ${skipped} hoppet over`)

  if (missing.length > 0) {
    console.log(`\n=== EAN-er som må fylles inn manuelt ===`)
    missing.forEach((ean) => console.log(ean))
    writeFileSync("missing-eans.txt", missing.join("\n") + "\n")
    console.log(`\nSkrevet til scripts/missing-eans.txt`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})