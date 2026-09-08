// One-off (step 1 of the "itinerary built from shops" rebuild): gets every place that
// appears in the hardcoded itinerary PLAN into the shopNote list, so the later migration
// has something to reference.
//
// Part A: fills latitude/longitude on 3 existing shopNote docs that currently lack them,
//         using the coordinates already present in the PLAN data for the matching stop.
// Part B: creates 6 new shopNote documents (placeType 'restaurant') for PLAN stops that
//         have no corresponding shopNote document at all.
//
// Usage:
//   npx tsx scripts/backfill-itinerary-shops.ts          (dry run — lists only, no writes)
//   npx tsx scripts/backfill-itinerary-shops.ts --live   (applies the patches/creates)
import { createClient } from "@sanity/client"

const readClient = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})
const writeClient = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_WRITE_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

const LIVE = process.argv.includes("--live")

// Part A — coordinates sourced from the matching PLAN stop's own lat/lng.
const COORD_PATCHES = [
  { id: "oe2xO1065MW4Af28laSHJP", name: "Ōimachi Station Market", latitude: 35.606832, longitude: 139.734280 },
  { id: "YWIgmQJfYTHI3k7jIzNuO3", name: "Soranoiro - Nippon", latitude: 35.680810, longitude: 139.769230 },
  { id: "XXZOGBYEpTVG0uv9djGrxN", name: "BOOKOFF AEON Honmoku Store", latitude: 35.417500, longitude: 139.660800 },
]

// Part B — new shopNote docs. `area` is the PLAN day's own `area` label, taken literally,
// EXCEPT Uobei: that day's PLAN area is the compound "Shibuya + Harajuku", which isn't a
// single value in the shopNote area list — using "Shibuya" instead (matches its actual
// coordinates, right by the other Shibuya stops). Flagged for confirmation before --live.
const NEW_RESTAURANTS = [
  { shopName: "Tsujita Akihabara", placeType: "restaurant", area: "Akihabara", latitude: 35.699031, longitude: 139.770140, note: "tsukemen" },
  { shopName: "Ramen Hayashida", placeType: "restaurant", area: "Shinjuku", latitude: 35.690729, longitude: 139.703751, note: "kontant" },
  { shopName: "Sushi Hatsume", placeType: "restaurant", area: "Shinjuku", latitude: 35.694050, longitude: 139.698016, note: "omakase, bestill bord" },
  { shopName: "Gyumon", placeType: "restaurant", area: "Ikebukuro", latitude: 35.733522, longitude: 139.709866, note: "wagyu ramen, 4.8★" },
  { shopName: "Uobei", placeType: "restaurant", area: "Shibuya", latitude: 35.659435, longitude: 139.697921, note: "transportbånd-sushi, rett ved PARCO" }, // area confirmed
  { shopName: "Yang Guo Fu Mala Tang", placeType: "restaurant", area: "Nakano", latitude: 35.708064, longitude: 139.665548, note: "nær Broadway" },
]

async function main() {
  console.log(`Mode: ${LIVE ? "LIVE — will write to Sanity" : "DRY RUN — no changes will be made"}\n`)

  console.log("=== Part A: coordinate patches on existing shopNote docs ===")
  for (const p of COORD_PATCHES) {
    const current = await readClient.fetch(`*[_id == $id][0]{ shopName, latitude, longitude }`, { id: p.id })
    console.log(`  ${p.id}  "${current?.shopName ?? "(NOT FOUND)"}"`)
    console.log(`    current: latitude=${current?.latitude ?? "null"}, longitude=${current?.longitude ?? "null"}`)
    console.log(`    new:     latitude=${p.latitude}, longitude=${p.longitude}`)
    if (LIVE) {
      await writeClient.patch(p.id).set({ latitude: p.latitude, longitude: p.longitude }).commit()
      console.log(`    -> patched`)
    }
  }

  console.log("\n=== Part B: new shopNote documents (placeType: restaurant) ===")
  for (const r of NEW_RESTAURANTS) {
    const existing = await readClient.fetch(`*[_type == "shopNote" && shopName == $name][0]{ _id }`, { name: r.shopName })
    console.log(`  "${r.shopName}"  area=${r.area}  lat=${r.latitude}  lng=${r.longitude}  note="${r.note}"`)
    if (existing) {
      console.log(`    !! A shopNote named "${r.shopName}" already exists (${existing._id}) — skipping to avoid a duplicate.`)
      continue
    }
    if (LIVE) {
      const created = await writeClient.create({ _type: "shopNote", shopName: r.shopName, placeType: r.placeType, area: r.area, latitude: r.latitude, longitude: r.longitude, note: r.note })
      console.log(`    -> created ${created._id}`)
    }
  }

  if (!LIVE) console.log("\nDry run only — nothing was changed. Re-run with --live to apply.")
}

main().catch((e) => { console.error(e); process.exit(1) })
