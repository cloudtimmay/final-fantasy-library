# Opprydding — Final Fantasy Library

Gjennomgang av hele prosjektet (Astro-frontend, Sanity Studio, importskript og rotfiler). Opprinnelig kun en rapport (ingen filer endret) — nå også fremdriftslogg ettersom oppryddingen gjennomføres bolk for bolk på `cleanup`-grena. Funn er rangert etter hvor trygt det er å rydde opp, fra tryggest til de som krever en avklaring først.

Kodebiter/identifikatorer er gjengitt på engelsk (som i kilden); løpende tekst er på norsk.

## Fremdrift

- [x] **Bolk 1 — `merch`/`figure`-navnesplitten.** Fullført og committet på `cleanup`-grena. Se status-notat i «Viktig sidefunn» under.
- [x] **Bolk 2 — søppel-fjerning.** Fullført og committet på `cleanup`-grena. De fire ubrukte filene og de to kode-bugene fra seksjon 1/3 er ryddet opp.
- [x] **Bolk 3 — `isNew()`-uttrekk til `astro/src/lib/dates.ts`.** Fullført og committet på `cleanup`-grena. (Opprinnelig planlagt sammen med punkt 2.5 (`wishlist.astro`/`got-it.js`), men det punktet ble i stedet flyttet til **Bevisst beholdt / ikke duplikasjon** etter at markup-forskjellen ble avdekket.)
- [x] **Bolk 4 — bildeopplasting-uttrekk til `astro/src/scripts/image-upload.js`.** Fullført og committet på `cleanup`-grena. API-json-hjelperen (2.7) var bevisst utelatt fra denne bolken og gjenstår som egen oppgave.
- [ ] Bolk 5 og videre — se **Anbefalt rekkefølge** nederst for foreslått neste steg.

---

## Viktig sidefunn: ufullstendig omdøping `merch` → `figure`

Dette er ikke ren "død kode", men en funksjonsfeil som ble avdekket underveis i gjennomgangen, og som forklarer flere av funnene under. Den bør fikses uansett om resten av oppryddingen gjøres.

Sanity-skjemaet for suvenirer/figurer heter `figure` (`sanity/schemaTypes/figure.ts`, tittel «Merchandise»). Det finnes **ikke** noe registrert skjema som heter `merch` (se `sanity/schemaTypes/index.ts`). Likevel:

- Den **faktiske** oppretting-endepunktet som brukes fra UI-et, [astro/src/pages/api/merch-create.ts](astro/src/pages/api/merch-create.ts), er feilnavngitt men skriver korrekt til `_type: 'figure'` — så nye varer havner riktig i skjemaet.
- Men følgende steder filtrerer/leser fortsatt på den gamle, ikke-eksisterende typen `"merch"`, og vil derfor **aldri** vise varer som faktisk er av typen `figure`:
  - [astro/src/pages/wishlist.astro](astro/src/pages/wishlist.astro) (linje 6, 13, dropdown-verdi)
  - [astro/src/pages/series.astro](astro/src/pages/series.astro) (linje 6)
  - [astro/src/pages/export.astro](astro/src/pages/export.astro) (linje 6)
  - [astro/src/pages/spending.astro](astro/src/pages/spending.astro) (linje 6)
  - [astro/src/pages/api/check-duplicate.ts](astro/src/pages/api/check-duplicate.ts) (linje 15)
- [astro/src/pages/api/item-status.ts](astro/src/pages/api/item-status.ts) sin `ALLOWED_TYPES` (linje 9) mangler `'figure'` helt, så **"Got it"-knappen på Merchandise-siden feiler alltid** (returnerer 400) — brukt via `got-it.js`.
- [astro/src/pages/api/figure-create.ts](astro/src/pages/api/figure-create.ts) og [scripts/import-figure-mfc.ts](scripts/import-figure-mfc.ts) skriver motsatt vei: de bruker det korrekte navnet «figure» i filnavn/kode, men lagrer faktisk dokumenter med `_type: 'merch'` — en type som ikke finnes i noe skjema og dermed er usynlig/ikke redigerbar i Sanity Studio.

**Praktisk konsekvens:** en merch-vare lagt til via appen havner riktig i Sanity, men vises aldri i Wishlist, Spending, Export-CSV, Series-oversikten eller strekkode-dublett-sjekken, og kan ikke markeres «Got it» fra oversiktssiden.

**Anbefalt fiks:** bytt `"merch"` → `"figure"` i de fem stedene i første kulepunkt-liste over, legg til `'figure'` i `item-status.ts` sin `ALLOWED_TYPES`, og fjern (eller rett opp) `figure-create.ts` og `import-figure-mfc.ts` sin `_type`.

**Status: Gjennomført (bolk 1 av oppryddingen).**
Sanity ble spurt før noe ble endret — 0 dokumenter hadde `_type == "merch"`, 80 hadde `_type == "figure"`, så ingen datamigrering var nødvendig. Følgende er rettet:
- `"merch"` → `"figure"` i `wishlist.astro`, `series.astro`, `export.astro`, `spending.astro`, `check-duplicate.ts`.
- `'figure'` lagt til i `item-status.ts` sin `ALLOWED_TYPES`.
- `astro/src/pages/api/figure-create.ts` slettet (ubrukt, og skrev til feil `_type`).
- `scripts/import-figure-mfc.ts` rettet: `_type: "merch"` → `_type: "figure"` (både i dokumentopprettelsen og i dedup-sjekken mot eksisterende strekkoder), samt `_id`-prefiks `merch-jan-` → `figure-jan-`.

Gjenstår: `merch-create.ts` er fortsatt feilnavngitt (skriver korrekt `_type: 'figure'`, men heter «merch-create»). Se **Gjenstående oppgaver** nederst i denne rapporten.

---

## 1. Filer, sider og endepunkter som ser ubrukte ut

Rangert fra tryggest å fjerne til de som bør avklares først.

### Trygt å fjerne

| Fil | Hvorfor |
|---|---|
| ~~`erskim_rOneDriveYmseProgrammingVStudioFinal Fantasy Librarycollection-registry`~~ (rotfil) | **Gjennomført (bolk 2).** Ikke kode i det hele tatt — innholdet var en dump av `git config --list`, tydelig et uhell fra en feiltolket kommando. Slettet. |
| ~~`astro/src/pages/api/figure-create.ts`~~ | **Gjennomført (bolk 1).** Ingen kallere funnet noe sted i kodebasen, og skrev i tillegg til en `_type` (`'merch'`) uten registrert skjema. Slettet. |
| ~~`sanity/components/MfcImport.tsx`~~ | **Gjennomført (bolk 2).** En ferdig input-komponent (søkeknapper mot MFC/Google/Google Images), men aldri koblet til `components.input` på noe felt i noe skjema. Slettet. |
| ~~`missing-isbns.txt`, `missing-eans.txt`~~ (rotfiler) | **Gjennomført (bolk 2).** Ren logg-output fra henholdsvis `scripts/import-books.ts` og `scripts/import-games.ts` — skrives, men ble aldri lest tilbake av noe skript. Slettet (regenereres ved neste kjøring om nødvendig). |

### Trolig trygt, men verifiser at de ikke trengs som referanse

| Fil | Hvorfor |
|---|---|
| `scripts/vgmdb-collection.html`, `scripts/vgmdb-image-results.csv`, `scripts/vgmdb-album-urls-from-excel.csv` | Ligger i `scripts/`, men ingen av de fem import-/oppdateringsskriptene leser dem (bekreftet med grep). Ser ut som rester fra en tidligere versjon av VGMdb-importflyten som senere ble erstattet av `update-vgmdb-album-details.ts` (som leser `FFalbumList.xlsx` direkte). |
| ~~`scripts/import-figure-mfc.ts`~~ | **Gjennomført.** Skrev til den ikke-eksisterende typen `merch` (dokumentopprettelse, `_id`-prefiks og dedup-sjekk). Rettet til `figure` i bolk 1 — skriptet er nå igjen et fungerende importverktøy. |

### Krever avklaring — ikke slett uten å bestemme dere

| Fil/side | Hvorfor |
|---|---|
| `astro/src/pages/import-places.astro` og `astro/src/pages/export-shops.astro` | Begge er fullt fungerende sider med egne API-kall (`/api/import-places`), men **ingen andre sider lenker til dem** — verken navigasjonen i `Base.astro`, `notes.astro` eller noe annet sted. De er kun nåbare ved å skrive URL-en direkte. Sannsynligvis bevisst «skjulte» engangsverktøy, men verdt å bekrefte — enten legg til en lenke fra `/notes`, eller fjern dem hvis de ikke lenger trengs. |
| `astro/src/pages/vgmdb.astro` | Lenket fra hovednavigasjonen, så den er ikke «ubrukt» i streng forstand — men hele funksjonaliteten (søk som åpner VGMdb i ny fane) er allerede duplisert inni `.vgmdb-lookup`-widgeten på `albums/index.astro`. Vurder å fjerne siden/nav-lenken og beholde kun widgeten på Albums-siden, eller omvendt. |
| README.md sitt avsnitt om Google Photos / `photoUrl`-feltet | Ikke kode, men dokumentasjon som beskriver en arbeidsflyt («lim inn Google Photos-lenke i `photoUrl`») som ikke finnes noe sted i kildekoden lenger. Appen bruker i dag Sanity-hostede `image`-felt (via `/api/upload-image`) og skrapet `externalImageUrl`. Bør oppdateres eller fjernes fra README. |
| `astro/.env.example` | Referert i README sitt oppsettsavsnitt («Copy `astro/.env.example` to `astro/.env`»), men filen finnes ikke i repoet. Enten manglet den ved en feil, eller så bør instruksjonen fjernes/oppdateres. |

---

## 2. Kode som gjentas på tvers av filer

Rangert fra enklest/tryggest å trekke ut til de som krever mer arbeid.

### 2.1 `isNew(acquiredDate)`-hjelpefunksjon — 5 kopier
Identisk 6-7 linjers funksjon i frontmatter på:
`index.astro`, `albums/index.astro`, `games/index.astro`, `books/index.astro`, `merchandise/index.astro`.
Ren server-side logikk uten avhengigheter — trivielt og helt trygt å flytte til f.eks. `astro/src/lib/dates.ts` og importere.

### 2.2 Bildeopplasting (kamera/galleri → `/api/upload-image`) — 4 kopier — ~~Gjennomført (bolk 4)~~
Nesten ordrett samme ~50-linjers `<script>`-blokk (inkl. `handleUpload`, feilhåndtering, oppdatering av forhåndsvisningsbildet) fantes i:
`albums/[id].astro`, `games/[id].astro`, `books/[id].astro`, `merchandise/[id].astro`.
**Gjennomført.** Trukket ut til `astro/src/scripts/image-upload.js` (`initImageUpload()`), etter samme mønster som `got-it.js`. Før sammenslåingen ble de fire kopiene bekreftet identiske i alt som betyr noe (element-ID-er, FormData-felt, endepunkt) bortsett fra placeholder-selektoren — `albums/[id].astro` brukte `.detail-photo` alene, de tre andre brukte den sammensatte `.detail-photo, .detail-photo-placeholder`. Den sammensatte selektoren ble valgt som felles løsning siden den dekker albums sin markup uendret. I `albums/[id].astro` ble kun opplastingsdelen fjernet fra `<script>`-blokken — YouTube-sporspilleren (`openPlayer`, `.track-play`/`.album-play`-håndtering, lukkeknapp) står urørt i samme blokk, med importen lagt til øverst. Testet med og uten eksisterende bilde på alle fire sidetyper.

### 2.3 Strekkodeskanner (html5-qrcode start/stop) — 4 kopier
`add.astro`, `add-item.astro`, `scan.astro` og `offline.astro` implementerer hver sin variant av samme skanner-livssyklus (`startScan`/`stopScan`, feilmeldinger, cleanup). Det er noen reelle forskjeller å ta hensyn til ved uttrekk:
- `offline.astro` laster skript-filen lokalt (`/html5-qrcode.min.js`, cachet av service workeren for offline bruk), mens de tre andre laster den fra CDN (`unpkg.com`).
- `add-item.astro` laster biblioteket lat (kun ved behov), de andre laster det eagerly med `<script is:inline src="...">`.

Fortsatt god kandidat for en delt modul (f.eks. `astro/src/scripts/barcode-scanner.js` med en konfigurerbar kilde-URL), men krever litt mer omtanke enn 2.1/2.2 pga. disse forskjellene.

### 2.4 `add-store.astro` og `edit-store.astro` — nesten identisk skjema-script
De to sidene deler et ~150 linjer langt script for koordinathåndtering, kart-lenke-bygging og «lim inn lat,lng»-parsing (`readCoordFields`, `setCoords`, `renderCoords`, `updateMapLink`, `applyPaste`, geolokasjon). Forskjellen mellom filene er stort sett bare at edit-varianten prefylles fra eksisterende data og kaller et annet API-endepunkt (`/api/shop-note` vs. `/api/shop-note-update`). Dette er den største enkelt-duplikasjonen i prosjektet og en god kandidat for enten (a) et delt script-modul, eller (b) å slå sammen de to sidene til ett skjema som tar en valgfri `?id=`-parameter.

### 2.6 Filter/sorter/søk-widgets og HUD-kort-CSS på de fire oversiktssidene
`albums/index.astro`, `games/index.astro`, `books/index.astro` og `merchandise/index.astro` deler en stor mengde nesten identisk CSS (`.hud-section-head`, `.hud-corner`, rad-hover-effekter, `.lookup-box`, `.got-btn` osv. — rundt 80–100 linjer CSS hver) og lignende JS for søk/sortering/filtrering (`updateAlbums`/`updateGames`/`updateBooks`/`updateMerchandise` — strukturelt like, men med feltspesifikke forskjeller). Dette er det største volumet av duplisert kode i prosjektet, men også det som krever mest arbeid og størst risiko å trekke ut riktig (delt CSS-fil/layout-komponent + en parameterisert filtreringsfunksjon), fordi feltene som filtreres på er forskjellige per type. Anbefales som en egen, mindre omfattende oppgave etter at punktene over er ryddet opp i.

### 2.7 API: delt `json()`-hjelper og try/catch-parsing i alle 15 endepunkter
Hvert eneste endepunkt i `astro/src/pages/api/` starter med samme mønster:
```js
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
// ...
let body
try { body = await request.json() } catch { return json(400, { error: 'Bad request' }) }
```
Trygt å trekke ut til en delt `astro/src/lib/api.ts` («respond», «parseJsonBody») — berører ikke forretningslogikk, kun boilerplate.

### 2.8 De fem "create"-endepunktene deler nesten hele implementasjonen
`album-create.ts`, `book-create.ts`, `game-create.ts`, `merch-create.ts` og `figure-create.ts` har identisk skjelett utover selve feltlisten: samme `num()`/`str()`-konverteringshjelpere (kopiert i to litt ulike stilvarianter — se `album-create.ts:16-17` vs. `merch-create.ts:22-23`), samme `if (str(body.X)) doc.X = str(body.X)`-mønster per felt, og samme try/catch rundt `sanityWrite.create(doc)`. God kandidat for en delt `createItem(type, fieldMap, body)`-hjelper — bygger videre på 2.7.

### 2.9 Mindre duplikasjon: strekkode-dublettsjekk og bilde-håndtering i `add.astro` vs. `add-item.astro`
Begge sidene har sin egen kopi av `checkDuplicate()` (kall til `/api/check-duplicate`) og kamera/galleri-velgeren for foto. Én reell forskjell: `add-item.astro` kjører bildet gjennom `resize-image.js` før opplasting, `add.astro` gjør det ikke — sannsynligvis en inkonsekvens snarere enn et bevisst valg, verdt å rette samtidig som duplikasjonen fjernes.

---

## Bevisst beholdt / ikke duplikasjon

Funn som først så ut som duplikasjon, men som ved nærmere undersøkelse dekker et reelt, ulikt behov — vurdert i bolk 3 og bevisst latt være urørt.

### `wishlist.astro` sin «Got it»-knapp vs. `astro/src/scripts/got-it.js`
Opprinnelig listet som punkt 2.5 («gjentatt kode»). Ved gjennomgang av markupen viste det seg at de to løser forskjellige UX-behov, ikke samme problem kopiert to steder:
- De fire kategori-oversiktssidene (`albums`, `games`, `books`, `merchandise`) viser en **blanding** av eide og ønskede varer i samme liste. Der bytter `got-it.js` sin `initGotIt()` en `.wishlist-tag`-badge til «OWNED» på raden (`wrap.dataset.wishlist = 'no'`, badge-bytte), fordi raden skal bli stående i visningen.
- `wishlist.astro` viser **kun** wishlist-varer. Der fjerner den egne inline-koden hele raden (`wrap.remove()`) og oppdaterer antall-telleren i toppen («X items») — fordi en kjøpt vare ikke lenger hører hjemme i en liste som per definisjon kun er ønskelisten.

`got-it.js` sin `initGotIt()` forutsetter markup wishlist.astro ikke har (`[data-wishlist="yes"]`-wrapper og `.wishlist-tag`-badge). Å bruke den uendret på wishlist.astro ville gitt en reell regresjon: knappen ville forsvunnet, men raden blitt stående uten badge-bytte, og telleren ville ikke oppdatert seg.

**Konklusjon:** koden i `wishlist.astro` beholdes som egen implementasjon. Å dele koden ville krevd å generalisere den mest gjenbrukte fila i appen (`got-it.js`, brukt av fire sider) for å dekke et femte, avvikende bruksmønster — liten gevinst (~25 linjer) mot risiko for å bryte noe alle fire sidene er avhengige av.

**Mulig fremtidig valg (ikke gjort nå):** generalisere `got-it.js` til å ta et valgfritt callback/options-argument for hva som skal skje ved suksess (badge-bytte som i dag, eller rad-fjerning + teller-oppdatering som i `wishlist.astro`). Dette bør i så fall være en egen, grundig testet bolk — endringen rører selve delen alle fire oversiktssidene bruker.

---

## 3. Død/feil kode i enkeltfiler

Rangert fra tryggest å fjerne til de som er mer en logikkfeil enn opprydding.

1. ~~**`astro/src/lib/sanity.ts:4`** — en glemt debug-linje~~ — **Gjennomført (bolk 2).**
   ```js
   console.log('SANITY ENV:', import.meta.env.SANITY_PROJECT_ID, import.meta.env.SANITY_DATASET, import.meta.env.SANITY_TOKEN ? 'token-finnes' : 'token-mangler')
   ```
   Kjørte ved hver serverstart/import og logget til serverkonsollen. Fjernet.

2. ~~**`astro/src/pages/vgmdb.astro`** — `var(--panel)`-CSS-bugen~~ — **Gjennomført (bolk 2).** CSS-en brukte `var(--panel)` to steder (input- og knapp-bakgrunn), men `--panel` var aldri definert i temaet (`Base.astro` definerer kun `--bg`, `--surface`, `--border` osv.), som ga en usynlig/feil bakgrunnsfarge på søkefeltet. Rettet til `var(--surface)`, som resten av siden bruker.

3. **Inkonsekvent `catch`-binding i API-filene** — `itinerary-save.ts`, `shop-coords.ts` og `upload-image.ts` skriver `catch (e)` uten å bruke `e`, mens de fleste andre endepunktene bruker `catch {}`. Ren stil-opprydding, ingen funksjonell effekt.

4. **`astro/src/pages/api/family-purchase-status.ts:24-31`** — patcher (`sanityWrite.patch(id).set({status}).commit()`) dokumentet *før* det sjekkes at `_type === 'familyPurchase'` (sjekken skjer etter commit). Kommentaren i koden sier at kun `familyPurchase`-dokumenter skal kunne endres, men rekkefølgen gjør at en vilkårlig dokument-id først blir skrevet til uansett type, og 400 kommer for sent. Sammenlign med `item-status.ts` og `shop-note-update.ts`, som validerer typen før de skriver. Dette er mer en robusthets-/sikkerhetsfeil enn ren død kode, men hører hjemme i samme opprydding.

5. **`astro/src/pages/api/shop-coords.ts`** — patcher `latitude`/`longitude` på en hvilken som helst dokument-id uten noen `_type`-sjekk i det hele tatt. Lavt praktisk risikonivå siden endepunktet kun kalles fra itinerary-siden med kjente shop-IDer, men verdt å rette til samme mønster som `shop-note-update.ts` hvis det ryddes opp i API-laget likevel.

6. **`item-status.ts` / `upload-image.ts` sine `ALLOWED_TYPES`-lister** mangler henholdsvis `'figure'` og `'merch'` — se det store funnet øverst i rapporten.

---

## Anbefalt rekkefølge

1. ~~Fiks `merch`/`figure`-navnesplitten~~ — **Gjennomført (bolk 1).** Se status-notatet øverst i rapporten.
2. ~~Fjern de fire ubrukte filene, debug-loggen i `sanity.ts` (punkt 3.1) og CSS-bugen i `vgmdb.astro` (punkt 3.2)~~ — **Gjennomført (bolk 2).**
3. ~~Trekk ut `isNew()` (2.1)~~ — **Gjennomført (bolk 3).** (Punkt 2.5 er ikke lenger en oppgave her — se **Bevisst beholdt / ikke duplikasjon**.)
4. ~~Trekk ut bildeopplasting (2.2)~~ — **Gjennomført (bolk 4).** API-json-hjelperen (2.7) ble bevisst holdt utenfor denne bolken og tas som egen oppgave.
5. Avklar skjebnen til `import-places.astro`, `export-shops.astro` og `vgmdb.astro` (lenke dem inn, eller fjern).
6. Ta strekkodeskanneren (2.3), skjema-duplikasjonen i add/edit-store (2.4) og create-endepunktene (2.8) som en egen runde — se også navnebyttet av `merch-create.ts` under **Gjenstående oppgaver**, som naturlig hører sammen med 2.8.
7. Vurder den store CSS/JS-duplikasjonen på oversiktssidene (2.6) som et eget, avgrenset refaktoreringsprosjekt til slutt.

---

## Gjenstående oppgaver (sporet, ikke gjort ennå)

- **Navnebytte `merch-create.ts` → `figure-create.ts`.** Endepunktet skriver korrekt til `_type: 'figure'`, men heter fortsatt «merch-create», noe som er misvisende nå som `merch`/`figure`-splitten (se øverst i rapporten) er rettet andre steder. Å bytte navn krever også å oppdatere referansen i `add-item.astro` (`CONFIG.merch.endpoint`). Bevisst utsatt til egen bolk for å holde denne endringen liten og lett å teste isolert.
