// Step 2 of the "itinerary built from shops" rebuild: match every stop in the SAVED
// itineraryState (the user's actual travel plan, 7 days / 56 stops) against shopNote
// documents by coordinate, the same way the earlier PLAN-vs-shops matching table was built.
//
// This script is READ-ONLY. It does not write anything to Sanity. It only reports the
// matching so the migration's write format can be designed afterwards.
//
// Usage:
//   npx tsx scripts/match-itinerary-stops.ts
import { createClient } from "@sanity/client"

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET || "production",
  token: process.env.SANITY_TOKEN!,
  apiVersion: "2024-01-01",
  useCdn: false,
})

type SavedStop = {
  name: string
  hours?: string
  tag?: string
  slot?: string
  lat?: number
  lng?: number
  shopId?: string
  fixedTime?: string | null
  dur?: number
}
type SavedDay = { startTime: string; stops: SavedStop[] }

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

async function main() {
  const stateDoc = await client.fetch(`*[_id == "itineraryState"][0]{ data }`)
  if (!stateDoc?.data) {
    console.error("No itineraryState document found!")
    process.exit(1)
  }
  const days: SavedDay[] = JSON.parse(stateDoc.data)

  const shops: { _id: string; shopName: string; latitude?: number; longitude?: number }[] = await client.fetch(
    `*[_type == "shopNote"]{ _id, shopName, latitude, longitude }`
  )
  const shopsWithCoords = shops.filter((s) => s.latitude != null && s.longitude != null)
  const shopById = new Map(shops.map((s) => [s._id, s]))

  const unmatched: { day: number; name: string; reason: string }[] = []
  let totalStops = 0

  days.forEach((day, di) => {
    console.log(`\n=== Dag ${di + 1} (startTime ${day.startTime}, ${day.stops.length} stopp) ===`)
    day.stops.forEach((stop) => {
      totalStops++

      if (stop.shopId) {
        const shop = shopById.get(stop.shopId)
        console.log(`  "${stop.name}"  ->  ALLEREDE shopId  ${stop.shopId}  (${shop ? shop.shopName : "!! finnes ikke i shopNote lenger"})`)
        if (!shop) unmatched.push({ day: di + 1, name: stop.name, reason: `har shopId ${stop.shopId}, men dokumentet finnes ikke lenger` })
        return
      }

      if (stop.lat == null || stop.lng == null) {
        console.log(`  "${stop.name}"  ->  INGEN MATCH (mangler koordinater på stoppet selv)`)
        unmatched.push({ day: di + 1, name: stop.name, reason: "stoppet har ingen lat/lng lagret" })
        return
      }

      const exact = shopsWithCoords.find((sh) => sh.latitude === stop.lat && sh.longitude === stop.lng)
      if (exact) {
        console.log(`  "${stop.name}"  ->  EXACT  "${exact.shopName}"  ${exact._id}`)
        return
      }

      let nearest: { sh: typeof shopsWithCoords[0]; d: number } | null = null
      for (const sh of shopsWithCoords) {
        const d = distM({ lat: stop.lat, lng: stop.lng }, { lat: sh.latitude!, lng: sh.longitude! })
        if (!nearest || d < nearest.d) nearest = { sh, d }
      }
      if (nearest && nearest.d <= 50) {
        console.log(`  "${stop.name}"  ->  NEAR (${Math.round(nearest.d)}m, dobbeltsjekk)  "${nearest.sh.shopName}"  ${nearest.sh._id}`)
        return
      }

      console.log(`  "${stop.name}"  ->  INGEN MATCH  (nærmeste: ${nearest ? `"${nearest.sh.shopName}" ${Math.round(nearest.d)}m unna` : "ingen shops med koordinater"})`)
      unmatched.push({
        day: di + 1,
        name: stop.name,
        reason: nearest ? `nærmeste shop er ${Math.round(nearest.d)}m unna ("${nearest.sh.shopName}") — for langt til å matche` : "ingen shops med koordinater i det hele tatt",
      })
    })
  })

  console.log(`\n\n=== UMATCHEDE STOPP (${unmatched.length} av ${totalStops}) ===`)
  if (unmatched.length === 0) {
    console.log("  Ingen — alle stopp matchet.")
  } else {
    for (const u of unmatched) {
      console.log(`  Dag ${u.day}: "${u.name}"  —  ${u.reason}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
