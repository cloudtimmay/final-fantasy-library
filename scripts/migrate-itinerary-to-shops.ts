// Step 2 of the "itinerary built from shops" rebuild: rewrites the SAVED itineraryState
// (the user's actual travel plan) so that stops stop duplicating name/lat/lng and rely
// purely on a shopId — the render code (already deployed) resolves those fields live from
// the shops list.
//
// Most saved stops (51 of 56) don't carry a shopId yet — they're copies of the original
// hardcoded PLAN objects, which never had one. So for every stop without a shopId, this
// script first tries to LINK it to its shopNote document by coordinate (same exact-match /
// near-match-within-50m logic used for the original PLAN-vs-shops matching table), and only
// then strips name/lat/lng. A stop that gets no match at all (no shopNote at that location)
// is left completely untouched — there's nothing to link it to.
//
// The one stop dropped entirely is "Test shop" on day 7 (its shopNote document is NOT
// touched by this script — only the plan entry is removed).
//
// Safe by construction:
//   - Day count, day order, stop order within each day, and startTime per day are
//     never touched.
//   - fixedTime/dur/tag/slot/hours are copied verbatim for every stop.
//   - A stop that can't be matched to any shop is copied through completely unchanged.
//
// Usage:
//   npx tsx scripts/migrate-itinerary-to-shops.ts          (dry run — no writes)
//   npx tsx scripts/migrate-itinerary-to-shops.ts --live    (writes the new itineraryState)
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
const DROP_STOP_IDS = new Set(["EncRux1Khyhm1n5v2lUqiX"]) // "Test shop" (day 7) — plan entry only, shopNote doc untouched

type Stop = Record<string, any>
type Day = { startTime: string; stops: Stop[] }
type Shop = { _id: string; shopName: string; latitude?: number; longitude?: number }

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

type Result = {
  day: number
  name: string
  status: "ALLEREDE shopId" | "KOBLET (exact)" | "KOBLET (near, dobbeltsjekk)" | "UKOBLET (fritekst)" | "FJERNET (Test shop)"
  shopId?: string
  shopName?: string
  distance?: number
}

function migrate(s: Stop, shopsWithCoords: Shop[], results: Result[], day: number): Stop | null {
  if (s.shopId && DROP_STOP_IDS.has(s.shopId)) {
    results.push({ day, name: s.name, status: "FJERNET (Test shop)", shopId: s.shopId })
    return null
  }

  if (s.shopId) {
    const { name, lat, lng, ...rest } = s
    results.push({ day, name: s.name, status: "ALLEREDE shopId", shopId: s.shopId })
    return rest
  }

  if (s.lat == null || s.lng == null) {
    results.push({ day, name: s.name, status: "UKOBLET (fritekst)" })
    return { ...s }
  }

  const exact = shopsWithCoords.find((sh) => sh.latitude === s.lat && sh.longitude === s.lng)
  if (exact) {
    const { name, lat, lng, ...rest } = s
    results.push({ day, name: s.name, status: "KOBLET (exact)", shopId: exact._id, shopName: exact.shopName })
    return { ...rest, shopId: exact._id }
  }

  let nearest: { sh: Shop; d: number } | null = null
  for (const sh of shopsWithCoords) {
    const d = distM({ lat: s.lat, lng: s.lng }, { lat: sh.latitude!, lng: sh.longitude! })
    if (!nearest || d < nearest.d) nearest = { sh, d }
  }
  if (nearest && nearest.d <= 50) {
    const { name, lat, lng, ...rest } = s
    results.push({ day, name: s.name, status: "KOBLET (near, dobbeltsjekk)", shopId: nearest.sh._id, shopName: nearest.sh.shopName, distance: Math.round(nearest.d) })
    return { ...rest, shopId: nearest.sh._id }
  }

  results.push({ day, name: s.name, status: "UKOBLET (fritekst)", distance: nearest ? Math.round(nearest.d) : undefined })
  return { ...s }
}

async function main() {
  console.log(`Mode: ${LIVE ? "LIVE — will write to Sanity" : "DRY RUN — no changes will be made"}\n`)

  const stateDoc = await readClient.fetch(`*[_id == "itineraryState"][0]{ data }`)
  if (!stateDoc?.data) {
    console.error("No itineraryState document found!")
    process.exit(1)
  }
  const oldData: string = stateDoc.data
  const days: Day[] = JSON.parse(oldData)

  const shops: Shop[] = await readClient.fetch(`*[_type == "shopNote"]{ _id, shopName, latitude, longitude }`)
  const shopsWithCoords = shops.filter((s) => s.latitude != null && s.longitude != null)

  const results: Result[] = []
  const newDays: Day[] = days.map((day, di) => ({
    startTime: day.startTime,
    stops: day.stops
      .map((s) => migrate(s, shopsWithCoords, results, di + 1))
      .filter((s): s is Stop => s !== null),
  }))
  const newData = JSON.stringify(newDays)

  console.log("=== Per stopp: status ===")
  results.forEach((r) => {
    let line = `  Dag ${r.day}: "${r.name}"  ->  ${r.status}`
    if (r.shopId) line += `  ${r.shopId}${r.shopName ? ` ("${r.shopName}")` : ""}`
    if (r.distance != null) line += `  [${r.distance}m]`
    console.log(line)
  })

  console.log("\n=== Stopp per dag: før -> etter ===")
  days.forEach((day, di) => {
    const before = day.stops.length
    const after = newDays[di].stops.length
    const mark = before !== after ? `  <- endret (${before - after} fjernet)` : ""
    console.log(`  Dag ${di + 1}: ${before} -> ${after}${mark}`)
  })

  const unmatched = results.filter((r) => r.status === "UKOBLET (fritekst)")
  console.log(`\n=== UKOBLEDE STOPP (${unmatched.length} av ${results.length - 1}, ekskl. Test shop) ===`)
  if (unmatched.length === 0) {
    console.log("  Ingen — samtlige 55 gjenværende stopp er koblet til en butikk.")
  } else {
    unmatched.forEach((r) => {
      console.log(`  Dag ${r.day}: "${r.name}"${r.distance != null ? `  (nærmeste shop ${r.distance}m unna — for langt)` : "  (ingen koordinater på stoppet)"}`)
    })
  }

  console.log("\n=== Eksempler: før/etter ===")
  const superPotato = days[0].stops.find((s) => s.name === "Super Potato")
  if (superPotato) {
    const migrated = migrate({ ...superPotato }, shopsWithCoords, [], 1)
    console.log(`\n  "Super Potato" (dag 1, ingen shopId fra før) FØR:`)
    console.log(`    ${JSON.stringify(superPotato)}`)
    console.log(`  "Super Potato" (dag 1) ETTER:`)
    console.log(`    ${JSON.stringify(migrated)}`)
  }
  const tokyoTempel = days[1].stops.find((s) => s.name === "Tokyo tempel")
  if (tokyoTempel) {
    const migrated = migrate({ ...tokyoTempel }, shopsWithCoords, [], 2)
    console.log(`\n  "Tokyo tempel" (dag 2, hadde allerede shopId + fixedTime + dur) FØR:`)
    console.log(`    ${JSON.stringify(tokyoTempel)}`)
    console.log(`  "Tokyo tempel" (dag 2) ETTER:`)
    console.log(`    ${JSON.stringify(migrated)}`)
  }
  const testShop = days[6].stops.find((s) => s.shopId && DROP_STOP_IDS.has(s.shopId))
  if (testShop) {
    console.log(`\n  "${testShop.name}" (dag 7) FØR:`)
    console.log(`    ${JSON.stringify(testShop)}`)
    console.log(`  ETTER: (fjernet fra planen — shopNote-dokumentet ${testShop.shopId} røres ikke)`)
  }

  console.log("\n=== Størrelse ===")
  const oldBytes = Buffer.byteLength(oldData, "utf-8")
  const newBytes = Buffer.byteLength(newData, "utf-8")
  console.log(`  Før:  ${oldBytes} bytes`)
  console.log(`  Etter: ${newBytes} bytes`)
  console.log(`  Diff: ${newBytes - oldBytes} bytes (${(((newBytes - oldBytes) / oldBytes) * 100).toFixed(1)}%)`)

  console.log("\n=== Verifisering: fixedTime, dur, tag, slot, hours, rekkefølge ===")
  let allOk = true
  days.forEach((day, di) => {
    const kept = day.stops.filter((s) => !(s.shopId && DROP_STOP_IDS.has(s.shopId)))
    const newStops = newDays[di].stops
    if (kept.length !== newStops.length) { allOk = false; console.log(`  !! Dag ${di + 1}: antall stopp stemmer ikke etter filtrering`); return }
    kept.forEach((oldS, i) => {
      const newS = newStops[i]
      if (oldS.name !== undefined && newS.name !== undefined && oldS.name !== newS.name) { allOk = false; console.log(`  !! Dag ${di + 1}, posisjon ${i}: rekkefølge/navn endret (${oldS.name} -> ${newS.name})`) }
      if ((oldS.fixedTime ?? null) !== (newS.fixedTime ?? null)) { allOk = false; console.log(`  !! Dag ${di + 1} "${oldS.name}": fixedTime endret (${oldS.fixedTime} -> ${newS.fixedTime})`) }
      if ((oldS.dur ?? null) !== (newS.dur ?? null)) { allOk = false; console.log(`  !! Dag ${di + 1} "${oldS.name}": dur endret (${oldS.dur} -> ${newS.dur})`) }
      if ((oldS.tag ?? "") !== (newS.tag ?? "")) { allOk = false; console.log(`  !! Dag ${di + 1} "${oldS.name}": tag endret`) }
      if ((oldS.slot ?? "") !== (newS.slot ?? "")) { allOk = false; console.log(`  !! Dag ${di + 1} "${oldS.name}": slot endret`) }
      if ((oldS.hours ?? "") !== (newS.hours ?? "")) { allOk = false; console.log(`  !! Dag ${di + 1} "${oldS.name}": hours endret`) }
    })
    if (day.startTime !== newDays[di].startTime) { allOk = false; console.log(`  !! Dag ${di + 1}: startTime endret`) }
  })
  console.log(allOk
    ? "  OK — ingen stopp mistet fixedTime, dur, tag, slot eller hours, og rekkefølgen er identisk (utover at Test shop er fjernet)."
    : "  !! Avvik funnet, se over — IKKE godkjenn før dette er rettet.")

  if (LIVE) {
    await writeClient.patch("itineraryState").set({ data: newData, updatedAt: new Date().toISOString() }).commit()
    console.log("\n-> itineraryState oppdatert i Sanity.")
  } else {
    console.log("\nDry run only — nothing was changed. Re-run with --live to apply.")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
