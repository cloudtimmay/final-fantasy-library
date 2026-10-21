# Opprydding — Final Fantasy Library

Kjente feil, bevisste avveininger og sporet, ikke-gjennomført arbeid for hele prosjektet (Astro-frontend, Sanity Studio, importskript og rotfiler). Øverst: åpne punkter etter prioritet. Deretter: detaljer og historikk for punkter som er gjort, som referanse.

Kodebiter/identifikatorer er gjengitt på engelsk (som i kilden); løpende tekst er på norsk.

## Åpne punkter

**Middels og Lav venter til etter Japan-turen (30. nov.–7. des. 2026).** Før turen gjøres kun Høy. Hver lenke peker til detaljene lenger ned.

### Høy

- **`series.astro` lenker merch til `/figures/<id>`, en rute som ikke finnes.** Samme feil som `wishlist.astro` hadde (nå rettet): `series.astro` linje 55 bygger lenken som `` `/${i._type}s/${i._id}` ``. Fiks: bruk `detailHref()` fra `astro/src/lib/collection-fields.ts`, som `wishlist.astro` og `scan.astro` allerede gjør. Oppdaget under wishlist-fiksen, ikke rettet ennå.

### Middels

- **Åpningstid-parseren finnes i fire kopier som må holdes i sync for hånd** — se [Sporede saker](#sporede-saker-detaljer).
- **`PEOPLE_LIST` må oppdateres for hånd sammen med `sanity/schemaTypes/peopleList.ts`** — fast synkroniseringsregel, se [Sporede saker](#sporede-saker-detaljer).
- **Planlagt beløp dobbelttelles på `/spending`** når en planlagt `familyPurchase` og en planlagt `priceEntry` gjelder samme vare uten strekkode på begge sider. Bevisst akseptert — se spending-punktet under [Sporede saker](#sporede-saker-detaljer).
- **Duplikat `checkDuplicate()` og foto-velger i `add.astro` vs. `add-item.astro`** — se 2.9. (Bildeforminskningen er gjort.)

### Lav

- Strekkodeskanneren er fortsatt kopiert i `add.astro`, `add-item.astro` og `offline.astro` — se 2.3.
- `add-store.astro`/`edit-store.astro` deler et nesten identisk skjema-script — se 2.4.
- Stor CSS/JS-duplikasjon på de fire oversiktssidene — se 2.6.
- `add.astro`: `.photo-name`/`.photo-preview` setter `display: block` uten `[hidden]`-override, så en tom, innrammet forhåndsvisningsboks vises før et bilde er valgt (og etter lagring). Kosmetisk. Fiks: `.photo-name[hidden], .photo-preview[hidden] { display: none; }`, samme mønster som `add-item.astro`.
- Spøkelsesfeltene `rating`/`tags` i `SHARED_FIELDS` og visningsblokkene for dem i de fire `[id].astro`-filene — se [Sporede saker](#sporede-saker-detaljer).
- Inkonsekvent `catch (e)` vs. `catch {}` i API-filene — se 3.3.
- `scripts/vgmdb-collection.html`, `scripts/vgmdb-image-results.csv`, `scripts/vgmdb-album-urls-from-excel.csv` leses ikke av noe skript (bekreftet med grep) — rester fra en tidligere VGMdb-importflyt, erstattet av `update-vgmdb-album-details.ts`. Verifiser at de ikke trengs som referanse før de fjernes.
- README beskriver en Google Photos/`photoUrl`-arbeidsflyt som ikke finnes i koden lenger (appen bruker Sanity-hostede `image`-felt og `externalImageUrl`), og viser til `astro/.env.example`, som ikke finnes i repoet.
- `PLAN`-literalen i `itinerary.astro` er ikke konvertert til `shopId`-format — se [Itinerary-rebuild](#itinerary-rebuild).
- Forsidens nedtelling (`index.astro`) bruker hardkodede datoer/klokkeslett i stedet for `tripSettings` — se spending-punktet under [Sporede saker](#sporede-saker-detaljer).
- `itinerary.astro` bruker to ulike vis/skjul-mønstre (`[hidden]` for `.add-form`/`.af-custom`, `.open`-klasse for `.mc-panel`) — se Funn under testing, punkt 2.
- `add-item.astro` sin `CONFIG.merch`-nøkkel og skjemaets `type=merch`-verdi heter fortsatt «merch» (endepunktet er omdøpt til `figure-create.ts`).
- Valgfritt: generalisere `got-it.js` med et callback for suksess-oppførsel — se **Bevisst beholdt**.

---

## Gjennomført før turen (oktober 2026)

Hver med egen commit og Playwright-dekning.

- **`family-purchase-status.ts` skrev før typesjekk** (tidligere 3.4) — henter nå dokumentet først: 404 hvis det ikke finnes, 400 hvis det ikke er `familyPurchase`, og patcher først deretter. Test: `tests/family-purchase-status.spec.ts` (en ikke-`familyPurchase`-id avvises og `_rev` er uendret). Commit `7fad210`.
- **`shop-coords.ts` lagret koordinater på hvilken som helst id** (tidligere 3.5) — POST følger nå samme mønster: 404 / 400 hvis ikke `shopNote`. (GET filtrerte allerede på `shopNote`.) Test: `tests/shop-coords.spec.ts`. Commit `8bb2ba4`.
- **`wishlist.astro` lenket merch til `/figures/<id>`** — `scan.astro` sin `detailHref()` er flyttet til `astro/src/lib/collection-fields.ts` og brukes nå av begge sidene. Test: `tests/wishlist.spec.ts`. Commit `11d00b5`.
- **`add.astro` lastet opp bilder i full størrelse** (del av 2.9) — bruker nå `resize-image.js` med samme innstillinger som `add-item.astro` (`resizeImage(file, 1600, 0.85)`). Test: `tests/add-photo-resize.spec.ts` (et 3000×2000 PNG lastes opp som 1600×1067 JPEG). Commit `092283f`.

---

## Viktig sidefunn: ufullstendig omdøping `merch` → `figure` (gjennomført)

Dette var ikke ren «død kode», men en funksjonsfeil som ble avdekket underveis i gjennomgangen, og som forklarte flere av funnene under.

Sanity-skjemaet for suvenirer/figurer heter `figure` (`sanity/schemaTypes/figure.ts`, tittel «Merchandise»). Det finnes **ikke** noe registrert skjema som heter `merch` (se `sanity/schemaTypes/index.ts`). Likevel:

- Det **faktiske** opprettelses-endepunktet som brukes fra UI-et — den gang kalt `merch-create.ts`, senere omdøpt til [astro/src/pages/api/figure-create.ts](astro/src/pages/api/figure-create.ts) (se **Sporede saker**) — skriver korrekt til `_type: 'figure'`, så nye varer havner riktig i skjemaet.
- Men følgende steder filtrerte/leste fortsatt på den gamle, ikke-eksisterende typen `"merch"`, og ville derfor **aldri** vise varer som faktisk er av typen `figure`:
  - [astro/src/pages/wishlist.astro](astro/src/pages/wishlist.astro) (linje 6, 13, dropdown-verdi)
  - [astro/src/pages/series.astro](astro/src/pages/series.astro) (linje 6)
  - [astro/src/pages/export.astro](astro/src/pages/export.astro) (linje 6)
  - [astro/src/pages/spending.astro](astro/src/pages/spending.astro) (linje 6)
  - [astro/src/pages/api/check-duplicate.ts](astro/src/pages/api/check-duplicate.ts) (linje 15)
- [astro/src/pages/api/item-status.ts](astro/src/pages/api/item-status.ts) sin `ALLOWED_TYPES` (linje 9) manglet `'figure'` helt, så **"Got it"-knappen på Merchandise-siden feilet alltid** (returnerte 400) — brukt via `got-it.js`.
- Det *daværende* `astro/src/pages/api/figure-create.ts` (en annen fil enn dagens — se merknad under) og [scripts/import-figure-mfc.ts](scripts/import-figure-mfc.ts) skrev motsatt vei: de brukte det korrekte navnet «figure» i filnavn/kode, men lagret faktisk dokumenter med `_type: 'merch'` — en type som ikke finnes i noe skjema og dermed er usynlig/ikke redigerbar i Sanity Studio.

**Praktisk konsekvens (før fiksen):** en merch-vare lagt til via appen havnet riktig i Sanity, men ble aldri vist i Wishlist, Spending, Export-CSV, Series-oversikten eller strekkode-dublett-sjekken, og kunne ikke markeres «Got it» fra oversiktssiden.

**Status: Gjennomført.**
Sanity ble spurt før noe ble endret — 0 dokumenter hadde `_type == "merch"`, 80 hadde `_type == "figure"`, så ingen datamigrering var nødvendig. Følgende er rettet:
- `"merch"` → `"figure"` i `wishlist.astro`, `series.astro`, `export.astro`, `spending.astro`, `check-duplicate.ts`.
- `'figure'` lagt til i `item-status.ts` sin `ALLOWED_TYPES`.
- Det daværende `astro/src/pages/api/figure-create.ts` slettet (ubrukt, og skrev til feil `_type`).
- `scripts/import-figure-mfc.ts` rettet: `_type: "merch"` → `_type: "figure"` (både i dokumentopprettelsen og i dedup-sjekken mot eksisterende strekkoder), samt `_id`-prefiks `merch-jan-` → `figure-jan-`.

> **Merk om navnegjenbruk:** filnavnet `astro/src/pages/api/figure-create.ts` er siden gjenbrukt — den korrekte, men feilnavngitte `merch-create.ts` ble senere omdøpt til nettopp `figure-create.ts`. Lenkene over til «det daværende» `figure-create.ts` viser altså til en annen, slettet fil enn den som ligger på den stien i dag.

---

## 1. Filer som er fjernet eller rettet

| Fil | Hva ble gjort |
|---|---|
| ~~`erskim_rOneDriveYmseProgrammingVStudioFinal Fantasy Librarycollection-registry`~~ (rotfil) | **Gjennomført.** Ikke kode i det hele tatt — innholdet var en dump av `git config --list`, tydelig et uhell fra en feiltolket kommando. Slettet. |
| ~~`astro/src/pages/api/figure-create.ts`~~ (den daværende) | **Gjennomført.** Ingen kallere funnet noe sted i kodebasen, og skrev i tillegg til en `_type` (`'merch'`) uten registrert skjema. Slettet. |
| ~~`sanity/components/MfcImport.tsx`~~ | **Gjennomført.** En ferdig input-komponent (søkeknapper mot MFC/Google/Google Images), men aldri koblet til `components.input` på noe felt i noe skjema. Slettet. |
| ~~`missing-isbns.txt`, `missing-eans.txt`~~ (rotfiler) | **Gjennomført.** Ren logg-output fra henholdsvis `scripts/import-books.ts` og `scripts/import-games.ts` — skrives, men ble aldri lest tilbake av noe skript. Slettet (regenereres ved neste kjøring om nødvendig). |
| ~~`scripts/import-figure-mfc.ts`~~ | **Gjennomført.** Skrev til den ikke-eksisterende typen `merch` (dokumentopprettelse, `_id`-prefiks og dedup-sjekk). Rettet til `figure` sammen med fiksen over — skriptet er nå igjen et fungerende importverktøy. |

---

## 2. Kode som gjentas på tvers av filer

### 2.1 `isNew(acquiredDate)`-hjelpefunksjon — 5 kopier — ~~Gjennomført~~
Identisk 6-7 linjers funksjon i frontmatter på `index.astro`, `albums/index.astro`, `games/index.astro`, `books/index.astro`, `merchandise/index.astro`. Flyttet til `astro/src/lib/dates.ts` og importert.

### 2.2 Bildeopplasting (kamera/galleri → `/api/upload-image`) — 4 kopier — ~~Gjennomført~~
Nesten ordrett samme ~50-linjers `<script>`-blokk (inkl. `handleUpload`, feilhåndtering, oppdatering av forhåndsvisningsbildet) fantes i:
`albums/[id].astro`, `games/[id].astro`, `books/[id].astro`, `merchandise/[id].astro`.
**Gjennomført.** Trukket ut til `astro/src/scripts/image-upload.js` (`initImageUpload()`), etter samme mønster som `got-it.js`. Før sammenslåingen ble de fire kopiene bekreftet identiske i alt som betyr noe (element-ID-er, FormData-felt, endepunkt) bortsett fra placeholder-selektoren — `albums/[id].astro` brukte `.detail-photo` alene, de tre andre brukte den sammensatte `.detail-photo, .detail-photo-placeholder`. Den sammensatte selektoren ble valgt som felles løsning siden den dekker albums sin markup uendret. I `albums/[id].astro` ble kun opplastingsdelen fjernet fra `<script>`-blokken — YouTube-sporspilleren (`openPlayer`, `.track-play`/`.album-play`-håndtering, lukkeknapp) står urørt i samme blokk, med importen lagt til øverst. Testet med og uten eksisterende bilde på alle fire sidetyper.

### 2.3 Strekkodeskanner (html5-qrcode start/stop) — delvis gjennomført (resten: Lav)
`add.astro`, `add-item.astro`, `scan.astro` og `offline.astro` implementerte hver sin variant av samme skanner-livssyklus (`startScan`/`stopScan`, feilmeldinger, cleanup).

**Delvis gjennomført:** `scan.astro` og `prices.astro` bruker nå en delt modul, `astro/public/barcode-scanner.js` (`window.createBarcodeScanner(containerId)` → `{ start(onDecode), stop(), isRunning() }`), som laster `/html5-qrcode.min.js` (selv-hostet) lat — først ved første `.start()`-kall, ikke ved sidelasting. Begge sidene laster modulen via `<script is:inline src="/barcode-scanner.js">` og kaller `window.createBarcodeScanner(...)`.

**Fortsatt ikke rørt — egne kopier gjenstår bevisst:** `add.astro`, `add-item.astro` og `offline.astro` har fortsatt hver sin separate `startScan`/`stopScan`-implementasjon. Reelle forskjeller å ta hensyn til hvis/når disse tre også skal migreres til samme modul:
- `offline.astro` laster skript-filen lokalt (`/html5-qrcode.min.js`, cachet av service workeren for offline bruk) — det samme som `barcode-scanner.js` nå gjør, så denne bør være uproblematisk å migrere.
- `add-item.astro` laster biblioteket lat (kun ved behov, som `barcode-scanner.js` nå også gjør), mens `add.astro` laster det eagerly (fra unpkg).

### 2.4 `add-store.astro` og `edit-store.astro` — nesten identisk skjema-script (Lav)
De to sidene deler et ~150 linjer langt script for koordinathåndtering, kart-lenke-bygging og «lim inn lat,lng»-parsing (`readCoordFields`, `setCoords`, `renderCoords`, `updateMapLink`, `applyPaste`, geolokasjon). Forskjellen mellom filene er stort sett bare at edit-varianten prefylles fra eksisterende data og kaller et annet API-endepunkt (`/api/shop-note` vs. `/api/shop-note-update`). Dette er den største enkelt-duplikasjonen i prosjektet og en god kandidat for enten (a) et delt script-modul, eller (b) å slå sammen de to sidene til ett skjema som tar en valgfri `?id=`-parameter.

### 2.6 Filter/sorter/søk-widgets og HUD-kort-CSS på de fire oversiktssidene (Lav)
`albums/index.astro`, `games/index.astro`, `books/index.astro` og `merchandise/index.astro` deler en stor mengde nesten identisk CSS (`.hud-section-head`, `.hud-corner`, rad-hover-effekter, `.lookup-box`, `.got-btn` osv. — rundt 80–100 linjer CSS hver) og lignende JS for søk/sortering/filtrering (`updateAlbums`/`updateGames`/`updateBooks`/`updateMerchandise` — strukturelt like, men med feltspesifikke forskjeller). Dette er det største volumet av duplisert kode i prosjektet, men også det som krever mest arbeid og størst risiko å trekke ut riktig (delt CSS-fil/layout-komponent + en parameterisert filtreringsfunksjon), fordi feltene som filtreres på er forskjellige per type. Anbefales som et eget, avgrenset refaktoreringsprosjekt.

### 2.7 API: delt `json()`-hjelper og try/catch-parsing i alle 14 endepunkter — ~~Gjennomført~~
Hvert eneste endepunkt i `astro/src/pages/api/` startet med samme mønster:
```js
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
// ...
let body
try { body = await request.json() } catch { return json(400, { error: 'Bad request' }) }
```
**Gjennomført.** Trukket ut til `astro/src/lib/api.ts` (`json()` og `parseJsonBody()`). Før sammenslåingen ble alle 14 filer gjennomgått: `json()`-hjelperen var ordrett identisk i samtlige, og 12 av 14 delte nøyaktig samme feilrespons ved ugyldig body (`json(400, { error: 'Bad request' })`), i to rene formateringsvarianter (flerlinjes vs. kompakt — ingen funksjonell forskjell). De 12 bruker nå `const body = await parseJsonBody(request); if (!body) return json(400, { error: 'Bad request' })`. To endepunkter avvek reelt og fikk kun `json()` importert, med egen parsing uendret: `upload-image.ts` (parser `request.formData()`, ikke JSON) og `check-duplicate.ts` (GET uten body). Bekreftet at alle 14 fortsatt returnerer nøyaktig samme feilrespons som før.

### 2.8 De fire "create"-endepunktene deler nesten hele implementasjonen — ~~Gjennomført~~
`album-create.ts`, `book-create.ts`, `game-create.ts` og `figure-create.ts` (den gang `merch-create.ts` — omdøpt senere, se **Sporede saker**; det urelaterte, opprinnelige `figure-create.ts` ble slettet tidligere) hadde identisk skjelett utover selve feltlisten: samme `num()`/`str()`-konverteringshjelpere (kopiert i to litt ulike stilvarianter), samme `if (str(body.X)) doc.X = str(body.X)`-mønster per felt, og samme try/catch rundt `sanityWrite.create(doc)`.

**Felt-mapping-bugs funnet og rettet før uttrekket (gjennomført).**
Før noe ble slått sammen, ble alle fire endepunktene sjekket felt for felt mot de faktiske Sanity-skjemaene (`sanity/schemaTypes/`). `album-create.ts` og `merch-create.ts` (nå omdøpt til `figure-create.ts`) var korrekte. To reelle, tidligere ikke-oppdagede bugs ble funnet:
- **`game-create.ts`** skrev `doc.creator`, et felt som ikke finnes i `game`-skjemaet (som har `developer`/`publisher`). `add-item.astro` sender UI-feltet «Publisher / Developer» som `creator` — verdien havnet i et usynlig, ikke-skjemadefinert felt. **Rettet:** `body.creator` → `doc.publisher`.
- **`book-create.ts`** hadde tre feil: skrev `doc.creator` (finnes ikke — skjemaet har `author`, som er **påkrevd**, og separat `publisher`), skrev `doc.series` (finnes ikke i det hele tatt i `book`-skjemaet), og skrev `doc.barcode` (skjemaet kaller feltet `isbn`). Mest alvorlig: `author` — et påkrevd felt — ble aldri satt på bøker lagt til via appen. **Rettet:** `body.creator` → både `doc.author` og `doc.publisher` (samme verdi), `body.barcode` → `doc.isbn`, `series`-linjen fjernet helt (feltet finnes ikke i skjemaet).
- `add-item.astro` sitt UI og feltnavnene i POST-bodyen (`creator`, `barcode`) er urørt — kun mappingen inne i endepunktene er rettet.

Sanity ble spurt etter fiksen (ikke for å migrere, bare for å sjekke skadeomfang): 0 av 74 `game`-dokumenter mangler `publisher`, 0 av 54 `book`-dokumenter mangler `author`. 8 bøker mangler `isbn` — alle er artbøker uten strekkode, forventet og ikke bug-relatert. Ingen manuell datarydding nødvendig; eksisterende data ser ut til å ha kommet inn via Studio/importskript, ikke via det buggede skjemaet.

**Selve uttrekket (gjennomført).**
Lagt til `buildDoc(base, body, fields)` i `astro/src/lib/api.ts` — hver `field` har `from` (nøkkel i body), valgfri `to` (én nøkkel eller en array av nøkler på doc-et, default samme som `from`) og valgfri `type: 'num'`. Dette dekket alle mappingene fra feltfiksen over uten spesialtilfeller i selve hjelperen: `game-create.ts` bruker `{ from: 'creator', to: 'publisher' }`, `book-create.ts` bruker `{ from: 'creator', to: ['author', 'publisher'] }` og `{ from: 'barcode', to: 'isbn' }` (ingen `series`-felt). De tre unntakene som ikke passer en generisk feltliste er beholdt per endepunkt, rett over `buildDoc()`-kallet: `album-create.ts` sin hardkodede `format: 'cd'` og `figure-create.ts` (den gang `merch-create.ts`) sin `category`-whitelist + `needsInfo: false`, begge i `base`-objektet (første argument). Ren refaktorering — ingen felt, mapping eller unntak endret. Verifisert ved å opprette ett ekte dokument av hver type i Studio: album (`format: cd`), spill (`publisher`), bok (`author` + `publisher` + `isbn`), merch (`category`) — alle riktige.

### 2.9 Mindre duplikasjon: strekkode-dublettsjekk og bilde-håndtering i `add.astro` vs. `add-item.astro` (Middels)
Begge sidene har sin egen kopi av `checkDuplicate()` (kall til `/api/check-duplicate`) og kamera/galleri-velgeren for foto. ~~Én reell forskjell: `add-item.astro` kjører bildet gjennom `resize-image.js` før opplasting, `add.astro` gjør det ikke.~~ — **Bildeforminskningen er gjennomført** (se **Gjennomført før turen**). Duplikasjonen gjenstår.

---

## Bevisst beholdt / ikke duplikasjon

Funn som først så ut som duplikasjon, men som ved nærmere undersøkelse dekker et reelt, ulikt behov — vurdert og bevisst latt være urørt.

### `wishlist.astro` sin «Got it»-knapp vs. `astro/src/scripts/got-it.js`
Opprinnelig listet som punkt 2.5 («gjentatt kode»). Ved gjennomgang av markupen viste det seg at de to løser forskjellige UX-behov, ikke samme problem kopiert to steder:
- De fire kategori-oversiktssidene (`albums`, `games`, `books`, `merchandise`) viser en **blanding** av eide og ønskede varer i samme liste. Der bytter `got-it.js` sin `initGotIt()` en `.wishlist-tag`-badge til «OWNED» på raden (`wrap.dataset.wishlist = 'no'`, badge-bytte), fordi raden skal bli stående i visningen.
- `wishlist.astro` viser **kun** wishlist-varer. Der fjerner den egne inline-koden hele raden (`wrap.remove()`) og oppdaterer antall-telleren i toppen («X items») — fordi en kjøpt vare ikke lenger hører hjemme i en liste som per definisjon kun er ønskelisten.

`got-it.js` sin `initGotIt()` forutsetter markup wishlist.astro ikke har (`[data-wishlist="yes"]`-wrapper og `.wishlist-tag`-badge). Å bruke den uendret på wishlist.astro ville gitt en reell regresjon: knappen ville forsvunnet, men raden blitt stående uten badge-bytte, og telleren ville ikke oppdatert seg.

**Konklusjon:** koden i `wishlist.astro` beholdes som egen implementasjon. Å dele koden ville krevd å generalisere den mest gjenbrukte fila i appen (`got-it.js`, brukt av fire sider) for å dekke et femte, avvikende bruksmønster — liten gevinst (~25 linjer) mot risiko for å bryte noe alle fire sidene er avhengige av.

**Mulig fremtidig valg (ikke gjort nå):** generalisere `got-it.js` til å ta et valgfritt callback/options-argument for hva som skal skje ved suksess (badge-bytte som i dag, eller rad-fjerning + teller-oppdatering som i `wishlist.astro`). Dette bør i så fall være en egen, grundig testet endring — den rører selve delen alle fire oversiktssidene bruker.

---

## 3. Død/feil kode i enkeltfiler

1. ~~**`astro/src/lib/sanity.ts:4`** — en glemt debug-linje~~ — **Gjennomført.**
   ```js
   console.log('SANITY ENV:', import.meta.env.SANITY_PROJECT_ID, import.meta.env.SANITY_DATASET, import.meta.env.SANITY_TOKEN ? 'token-finnes' : 'token-mangler')
   ```
   Kjørte ved hver serverstart/import og logget til serverkonsollen. Fjernet.

2. ~~**`astro/src/pages/vgmdb.astro`** — `var(--panel)`-CSS-bugen~~ — **Gjennomført.** (Siden er senere fjernet helt.)

3. **Inkonsekvent `catch`-binding i API-filene (Lav)** — `itinerary-save.ts`, `shop-coords.ts` og `upload-image.ts` skriver `catch (e)` uten å bruke `e`, mens de fleste andre endepunktene bruker `catch {}`. Ren stil-opprydding, ingen funksjonell effekt.

4. ~~**`astro/src/pages/api/family-purchase-status.ts`** — patchet dokumentet *før* det ble sjekket at `_type === 'familyPurchase'`.~~ — **Gjennomført**, se **Gjennomført før turen**.

5. ~~**`astro/src/pages/api/shop-coords.ts`** — patchet `latitude`/`longitude` på en hvilken som helst dokument-id uten `_type`-sjekk.~~ — **Gjennomført**, se **Gjennomført før turen**.

---

## Sporede saker (detaljer)

- ~~**Navnebytte `merch-create.ts` → `figure-create.ts`.**~~ — **Gjennomført.** Endepunktet skrev alltid korrekt til `_type: 'figure'`, men het misvisende «merch-create». Omdøpt med `git mv` (historikken følger med). `add-item.astro` sin `CONFIG.merch.endpoint` er oppdatert til `/api/figure-create` — kun endepunkt-URL-en ble endret, `merch`-nøkkelen i `CONFIG` og skjemaets `type=merch`-verdi er urørt (eget, separat spørsmål om det også bør ryddes — står under Lav). Søk gjennom hele prosjektet før omdøping bekreftet at dette var de to eneste kodereferansene til det gamle navnet. Det opprinnelige, urelaterte `figure-create.ts` (som skrev feil `_type: 'merch'`) ble slettet tidligere — filnavnet er altså gjenbrukt for en annen, korrekt fil. Se merknaden i «Viktig sidefunn» øverst.

- ~~**`add-item.astro` har samme `[hidden]`-vs-CSS-bug som itinerary-fiksen.**~~ — **Gjennomført**, i to omganger som sideeffekt av annet arbeid (AI-identify-flyten på `add-item.astro`, og "Who owns it?"-feltet): `.photo-name`/`.photo-preview` (begge `display: block`) fikk `[hidden]`-override da Remove-photo-knappen ble lagt til; `.field-row` (`display: flex`, bl.a. brukt av Pris (JPY)/(NOK)-raden) fikk sin da familie-eier-valget trengte å skjule den raden. Alle tre er nå `[hidden] { display: none; }` i `add-item.astro` sin stil, samme minimale mønster som itinerary-fiksen. (`add.astro` har fortsatt samme bug — se Lav.)

- **Spøkelsesfelt i GROQ-projeksjoner: `rating`, `tags` (delt `SHARED_FIELDS`) og `location` (kun `merchandise/[id].astro`) (Lav).** Oppdaget under arbeidet med on-site redigering av samleobjekter (album/spill/bok/merch). `astro/src/lib/sanity.ts` sin `SHARED_FIELDS`-GROQ-fragment projiserer `rating` og `tags`, men **ingen** av de fire skjemaene (`album.ts`, `game.ts`, `book.ts`, `figure.ts`) eller `shared.ts` definerer disse feltene — de har alltid vært `undefined`/tomme, og de betingede visningene (`{a.rating && ...}`, `{a.tags?.length > 0 && ...}`) på alle fire detaljsidene har dermed aldri vist noe. Tilsvarende spurte `merchandise/[id].astro` etter `location`, et felt som heller ikke finnes i `figure.ts`. Ingen av disse tre er tatt med i de nye redigeringsskjemaene (kan ikke redigere et felt som ikke finnes i skjemaet), og `location`-projeksjonen er fjernet fra `merchandise/[id].astro` sin spørring. `rating`/`tags`-projeksjonen og de tilhørende visnings-blokkene i alle fire `[id].astro`-filene er **ikke** fjernet — ren opprydding uten funksjonell konsekvens.

- ~~**`wishlist.astro` har samme `/${type}s/${id}`-rutefeil for merch som `scan.astro` hadde.**~~ — **Gjennomført**, se **Gjennomført før turen**. (`series.astro` har samme feil — se Høy.)

- ~~**`add-price.astro` sine `renderSeenList()`/`renderNameWarning()`-elementer har samme scoped-CSS-vs-`createElement()`-bug som AI-identify-funksjonen hadde.**~~ — **Gjennomført.** Oppdaget ved siden av CSS-fiksen for identify-funksjonens forslagskort og ekstra-bilde-miniatyrer (to JS-opprettede elementer der stilen ikke traff, fordi Astro sin scoped CSS kun legges på elementer skrevet direkte i `.astro`-malen — ikke på elementer laget med `document.createElement()` i en `<script>`). Samme rotårsak gjaldt `.seen-main`/`.seen-source`/`.seen-price`/`.seen-note` (brukt av «Sett før»-lista) og `.name-warning-row`/`.use-existing-btn` (brukt av dubletnavn-varselet). Underveis ble det også oppdaget at `.seen-list li` var rammet av samme bug selv om `.seen-list`-regelen selv (på den statisk-skrevne `<ul>`) fungerte fint — Astro legger scope-attributtet på det siste leddet i en etterkommer-selector, så `li`-en manglet attributtet siden den også lages med `createElement()`. Alle seks klassene (pluss `.seen-list li`, erstattet med en egen `.ap-seen-item`-klasse) flyttet til den eksisterende `<style is:global>`-blokken med «ap-»-prefiks, og `className`-tildelingene i `renderSeenList()`/`renderNameWarning()` oppdatert tilsvarende (inkludert en manglende `li.className` som tidligere kun stolte på den virkningsløse `.seen-list li`-selectoren). Samme sjekk av `edit-product.astro` avdekket identisk bug i `checkNameNote()`: `.name-note-row`, brukt av en JS-opprettet `<div>`, lå i den vanlige scoped `<style>`-blokken. Flyttet til en ny `<style is:global>`-blokk med eget, sidespesifikt prefiks `ep-` (`.ep-name-note-row`), siden `edit-product.astro` er en egen side uten forbindelse til `add-price.astro` sitt «ap-»-navnerom.

- **`PEOPLE_LIST` i `astro/src/lib/price-entry-fields.ts` er en kopi av `sanity/schemaTypes/peopleList.ts`, og må oppdateres sammen med den (Middels — fast regel).** Innført under pris-sporing-funksjonen (kjøpsflyten på `/edit-price`) fordi Astro-appen og Sanity Studio er to separate pakker uten en delt modulsti — samme årsak som andre små duplikate lister i prosjektet (f.eks. kategori-labels). Legges noen i/fjernes fra `peopleList` i Studio uten at `PEOPLE_LIST` oppdateres tilsvarende, vil kjøper-nedtrekkslisten på `/edit-price` vise feil/utdaterte navn. Ingen kodefeil i dag — bare en manuell synkroniseringsregel å huske på fremover.

- ~~**Redesign `spending.astro`**~~ — **Gjennomført**, i seks små steg (hvert med egen commit og Playwright-dekning): schema (`tripSettings.startDate`/`endDate`, `shopNote.taxFreeShop`), `lib/spending.ts` (spørringer + rene hjelpefunksjoner), fjernet «Min FF-samling»-seksjonen helt, tur-ramme-kort med reell dato-basert aktiv-tur-logikk (pågående i dag → neste kommende → sist avsluttede → udaterte sist), per-person-kort (budsjett/kjøpt/planlagt/gjenstående/tollfri-grense), og butikk/dag-seksjonen omskrevet til det nye refusjonssystemet (gjeldende fra 1. nov. 2026). Alle fire opprinnelige uklarheter er løst: samlingsseksjonen er borte (ingen dobbelttelling lenger), tur-nivå `budgetNok`/`budgetYen` er nå eksplisitt «familiens ramme» sammenlignet mot alles kjøp, og `activeTripId` bruker ekte datoer i stedet for å falle tilbake til eldste tur.
  - **Bevisst utelatt (Lav):** forsidens nedtelling (`index.astro`) bruker fortsatt hardkodede JS-datoer (med klokkeslett for avgang/hjemreise) — `tripSettings.startDate`/`endDate` er kun dato, uten klokkeslett, så en fullverdig migrering krever enten å akseptere grovere presisjon eller å legge til egne tidspunkt-felt.
  - **Bevisst akseptert (Middels):** planlagt-beløpet dobbelttelles fortsatt i ett konkret, smalt tilfelle: en planlagt `familyPurchase` og en planlagt `priceEntry` for samme vare telles kun én gang HVIS de har identisk strekkode/JAN — uten strekkode på begge sider kan de ikke matches, og telles da på begge sider (se commit-melding for «Per-person spending cards»).

- **Åpningstid-parseren (`parseOpeningHours`/`looksClosed`) er duplisert fire steder, og må holdes i sync for hånd (Middels).** Den finnes i `astro/src/pages/itinerary.astro` (den opprinnelige, autoritative kopien — brukes der til å vise «stengt?»-varsel per stopp), `astro/src/pages/api/shop-info.ts` (`parseOpeningHoursRange`, validerer AI-forslag til åpningstid før de godtas), `astro/src/pages/api/itinerary-review.ts` (sender åpningstid videre til AI-modellen, ingen egen parsing-bruk utover det) og `astro/src/lib/route-optimizer.ts` (brukes av «Suggest route»-optimizeren til å beregne venting/stengt-straff). Årsaken til duplikasjonen: itinerary.astro sitt hovedskript er bevisst holdt som `<script is:inline>` (for stort/skjørt til å trygt konverteres til en modul nå) og kan derfor ikke importere fra `src/lib`, så hver fil som trengte parsingen fikk sin egen kopi i stedet — samme mønster som `PEOPLE_LIST`-punktet over, bare med fire kopier i stedet for to.
  - **Anbefalt fiks (etter turen):** flytt parseren til én delt modul i `src/lib` (f.eks. `src/lib/opening-hours.ts`), og la `itinerary.astro` sitt inline-skript få tilgang til den på samme måte som `window.__routeOptimizer` allerede gjør i dag — et lite, separat `<script>` (ikke `is:inline`, og uten eksplisitt `type="module"`, som viste seg å få Astro til å hoppe over sin egen import-bundling) som importerer funksjonen og henger den på `window`. De tre andre filene (`shop-info.ts`, `itinerary-review.ts`, `route-optimizer.ts`) kan da importere direkte fra den samme modulen som vanlig, siden de allerede er ordinære moduler uten `is:inline`-begrensningen.

---

## Funn under testing

Oppdaget mens API-json-uttrekket (2.7) ble testet manuelt. Ikke relatert til selve uttrekket — egne, eksisterende feil/opprydding, tatt som egne endringer.

1. ~~**`astro/src/pages/api/shop-note.ts` (opprettelse) lagret ikke `placeType`, `openingHours` eller `trips`.**~~ — **Gjennomført.** Sammenlignet felt for felt med [astro/src/pages/api/shop-note-update.ts](astro/src/pages/api/shop-note-update.ts): opprettelses-endepunktet satte kun `shopName`, `area`, `note`, `priority`, `address`, `latitude`, `longitude` — `body.placeType`, `body.openingHours` og `body.tripIds` ble aldri lest, selv om `add-store.astro` sender alle tre. Underveis ble det også oppdaget at `area`-valideringen på API-nivå var strengere enn update sin (en fast 6-verdis whitelist i stedet for en fri, 60-tegns-kuttet streng) — noe som ville forkastet et egendefinert områdenavn valgt via «+ New area…» i skjemaet. Rettet ved å speile `shop-note-update.ts` nøyaktig for alle fire feltene (`placeType`-whitelist, `trips` som referanse-array med `_key`, `openingHours` trimmet/kuttet til 200 tegn, `area` fri streng kuttet til 60 tegn på API-nivå — ingen whitelist der, siden update alt er sånn). `num()`-hjelperen og resten av feltene er urørt. Verifisert i Studio: type, tur, område og åpningstider lagres nå riktig ved opprettelse.

   **Oppfølging på `area` — Sanity-skjemaets forslagsliste (separat, committet):** i stedet for å stole på fri tekst alene, ble det besluttet å beholde en fast liste i `sanity/schemaTypes/shopNote.ts` (Studio sitt `options.list` for `area` — kun et forslagssett i Studio-UI-et, ikke en hard valideringsregel, så det står ikke i konflikt med at API-et tillater fri streng). En spørring mot Sanity viste 13 unike `area`-verdier i bruk på 66 `shopNote`-dokumenter, mot 10 i skjemaets liste — 5 manglet: `Tokyo Station` (5 stk.), `Ginza`, `Harajuku`, `Odawara`, `Yoyogi` (1 hver). Alle fem lagt til i listen, skrevet nøyaktig som de allerede lå lagret i dataene. De ti eksisterende (inkl. det ubrukte `Osaka`) er urørt. Deployet til Studio og verifisert.

2. ~~**Itinerary-siden: «Legg til stopp» gjør ingenting ved klikk, ingen konsoll- eller serverfeil.**~~ — **Gjennomført.** I `astro/src/pages/itinerary.astro` sitt add-stop-flow (`.add-stop-btn` åpner `.add-form`, `.af-save` skal kalle `addShopStop()`/`addCustomStop()`) skjedde det ingenting synlig, verken ved valg av butikk fra lista eller ved fritekst-alternativet (`.af-custom`, felt for egne stopp som frokost/reise/severdigheter) — begge veier var brutt. Fritekst-alternativet er en ønsket funksjon og ble **beholdt**.

   **Rotårsak:** `attachEvents()`-kobling, klassenavn og `di`-utregning ble gjennomgått linje for linje — ingen mismatch eller stale-listener-bug. Fant i stedet en CSS-bug: `.add-form`/`.af-custom` satte `display: flex` ubetinget, noe som (per CSS-cascade-regler — forfatter-CSS slår alltid nettleserens standard-`[hidden]`-regel) gjorde at `hidden`-attributtet aldri hadde noen visuell effekt — skjemaet sto alltid åpent, uansett hva `form.hidden`/`custom.hidden` ble satt til i JS. **Rettet** med en minimal, ren CSS-tilføyelse: `.add-form[hidden], .af-custom[hidden] { display: none; }` — ingen JS eller markup rørt. Grundig testet og bekreftet av bruker (alle seks sjekkpunktene grønne: knappen åpner/lukker skjemaet synlig, legg til fra nedtrekksliste virker, legg til fritekst virker, på flere dager, ingen regresjon).

   **Bifunn (Lav):** `.add-form`/`.af-custom` styrer synlighet via `[hidden]`-attributtet, mens `.mc-panel` (samme fil) bruker en `.open`-klasse som veksles med `classList.toggle()`. To ulike mønstre for samme type vis/skjul-logikk i samme fil — kan harmoniseres senere om ønskelig.

3. ~~**Itinerary-siden: to «legg til»-knapper der én er overflødig.**~~ — **Løst via fiksen i punkt 2, ingen egen endring nødvendig.** `.add-stop-btn` («+ Legg til stopp», åpner skjemaet) og `.af-save` («Legg til», inni skjemaet) fremsto som to overlappende «legg til»-handlinger — men det viste seg å være samme rotårsak som punkt 2: så lenge `[hidden]`-CSS-buggen gjorde at skjemaet alltid sto åpent, virket «+ Legg til stopp» som en overflødig, gjentatt knapp ved siden av «Legg til». Etter CSS-fiksen veksler «+ Legg til stopp» korrekt skjemaet av/på, og «Legg til» sender inn — to tydelig separate, ikke-overlappende handlinger (samme mønster som en «+»-knapp som åpner et skjema, og en «Send»-knapp inni det). Ingen egen UI-opprydding trengs.

4. ~~**258 album-dokumenter hadde et spøkelses-`year`-felt som ikke finnes i album-skjemaet** (Studio viste «Unknown field found: year»).~~ — **Gjennomført.** Oppdaget under testing av `buildDoc()`-uttrekket for create-endepunktene. Album-skjemaet bruker `releaseDate` (streng), ikke `year` — verifisert at ingen aktiv kode (`album-create.ts`, `import-vgmdb-wishlist.ts`, `update-vgmdb-album-details.ts`) skriver `year`. Kilden ble sporet i git-historikken til et nå **slettet** skript (`scripts/scrape-vgmdb.ts`, fjernet i commit `9b9f5be`), som regnet ut `year` fra det skrapede `releaseDate` og lagret det. Da skriptet senere ble skrevet om til dagens `update-vgmdb-album-details.ts` (kun `releaseDate`), ble de gamle `year`-verdiene stående igjen — Sanity-patcher er additive og fjerner ikke felt som ikke nevnes. Ryddet med et engangsskript (`scripts/cleanup-album-year-field.ts`, dry-run + `--live`-modus, kun `.unset(['year'])` på `_type == "album"`), etter full backup av production-datasettet (`sanity dataset export`, verifisert og kopiert til varig lagring utenfor repoet). Kjørte først med feil token (`SANITY_TOKEN`, kun lesetilgang) som feilet på dokument 0 uten å skrive noe; rettet til `SANITY_WRITE_TOKEN` og kjørte på nytt. Alle 258 oppdatert, `releaseDate` og øvrige felt urørt, totalt antall album-dokumenter uendret (266). Verifisert i Studio og med spørring etterpå. Engangsskriptet er slettet igjen etter bruk — samme mønster som andre engangsskript i denne rapporten.

---

## Itinerary-rebuild

Stor omlegging (gjort på en egen gren, `itinerary-from-shops`, nå merget til `main` og slettet): itinerary-planen skal bygges fra `shopNote`-lista i stedet for en hardkodet `PLAN`-array i `itinerary.astro` (de to har i praksis vært dobbeltregistreringer av de samme ~55 stedene, uten noen delt `_id`). Gjennomført trinnvis, med full `sanity dataset export`-backup til `C:\Users\User\Documents\Final-Fantasy-Library\sanity-backups\` (utenfor repoet) før hvert steg som skriver til produksjonsdata.

**Nøkkelfunn før ombyggingen startet (flettelogikken i `buildState()`/`loadSaved()`):** en allerede lagret plan (`itineraryState` i Sanity, eller `localStorage`) overlever ombyggingen uendret, fordi `saved[di].stops` alltid vinner over `plan[di].stops` når det finnes lagret data for den dagindeksen. Eneste harde krav: **antall dager og rekkefølge må holdes identisk (7 dager, samme rekkefølge)**, siden koblingen mellom lagret data og ny plan-kilde er indeks-basert, ikke navn/dato-basert. `date`/`area`/`note` hentes derimot friskt fra plan-kilden hver gang (aldri lagret).

### Steg 0 — grunnmur (gjennomført)
- Bekreftet `main` ren, forbedring B (`764519f`) committet.
- Ny gren `itinerary-from-shops` opprettet fra `main`.
- Fersk full backup: `production-backup-2026-09-07-pre-itinerary-rebuild.tar.gz` (≈142,7 MB, 545 dokumenter + 165 assets), i `C:\Users\User\Documents\Final-Fantasy-Library\sanity-backups\`.

### Steg 1 — få alle PLAN-steder inn i shops-lista (gjennomført)
Kartla alle 52 faste PLAN-stopp mot `shopNote` på koordinater (eksakt match, «dobbeltsjekk» innen 50 m, eller ingen match). 3 fantes i shop-lista uten koordinater, 6 fantes ikke i det hele tatt (rene restauranter), resten matchet allerede eksakt.

Kjørt via `scripts/backfill-itinerary-shops.ts` (dry-run + `--live`, samme mønster som year-ryddingen). Verifisert i Studio og godkjent av bruker.

**Del A — koordinater fylt inn på 3 eksisterende `shopNote`-dokumenter** (var `null`/`null` fra før):
| `_id` | Butikk | Nye koordinater |
|---|---|---|
| `oe2xO1065MW4Af28laSHJP` | Ōimachi Station Market | `35.606832, 139.734280` |
| `YWIgmQJfYTHI3k7jIzNuO3` | Soranoiro - Nippon | `35.680810, 139.769230` |
| `XXZOGBYEpTVG0uv9djGrxN` | BOOKOFF AEON Honmoku Store | `35.417500, 139.660800` |

**Del B — 6 nye `shopNote`-dokumenter opprettet** (`placeType: 'restaurant'`, `note` renset fra PLAN sin `hours`-tekst):
| Navn | `_id` | Område | Note |
|---|---|---|---|
| Tsujita Akihabara | `ThE87wkuJDLOFIslBjfJkX` | Akihabara | tsukemen |
| Ramen Hayashida | `fSb1d0FWnzqgPYhEtAN5RF` | Shinjuku | kontant |
| Sushi Hatsume | `xcNFYqDbvgwSZNlsstJXtN` | Shinjuku | omakase, bestill bord |
| Gyumon | `fSb1d0FWnzqgPYhEtAN5iG` | Ikebukuro | wagyu ramen, 4.8★ |
| Uobei | `xcNFYqDbvgwSZNlsstJYEX` | Shibuya (PLAN sin dag hadde sammensatt `Shibuya + Harajuku` — «Shibuya» valgt siden det stemmer med koordinatene) | transportbånd-sushi, rett ved PARCO |
| Yang Guo Fu Mala Tang | `ThE87wkuJDLOFIslBjfKXZ` | Nakano | nær Broadway |

### Steg 2 — render slår opp via shopId, deretter migrer lagret plan (gjennomført)
Render-koden i `itinerary.astro` fikk en `resolveStop()`-funksjon: slår opp `shopId` i shops-lista for `name`/`lat`/`lng`, med trygg fallback til stoppets egne felt (butikk slettet, butikk uten koordinater, eller shops-lista ikke lastet). Alle steder som brukte `s.name`/`s.lat`/`s.lng` (kartpins, gangtid, rutelenker, «mangler koordinater»-merket, butikk-lenken) bruker nå samme oppslag. 100 % bakoverkompatibelt — ingen synlig endring da dagens stopp fortsatt hadde alle feltene.

Deretter migrert den lagrede planen (`itineraryState`, Sanity-dokumentet bak «din faktiske reiseplan»): av 56 lagrede stopp hadde kun 4 allerede `shopId` (lagt til via nedtrekksmenyen) — de resterende 51 ble automatisk koblet til riktig `shopNote` via samme eksakte koordinat-match (0 umatchede), og deretter slanket (`name`/`lat`/`lng` fjernet, `hours`/`tag`/`slot`/`fixedTime`/`dur` bevart uendret). «Test shop»-stoppet på dag 7 ble fjernet fra planen (shopNote-dokumentet `EncRux1Khyhm1n5v2lUqiX` er urørt). Resultat: 6904 → 5145 bytes (−25,5 %). Punktsikring av `itineraryState` tatt før kjøring (`itinerarystate-backup-2026-09-08.json` i `C:\Users\User\Documents\Final-Fantasy-Library\sanity-backups\`).

**Driftsuhell og fiks:** render-oppslaget og datamigreringen ble først kun committet på en egen gren (`itinerary-from-shops`), mens `--live`-migreringen skrev direkte til det delte produksjons-Sanity-datasettet (Sanity-skriving er uavhengig av git-gren). Dette gjorde produksjonssiden midlertidig ødelagt for alle besøkende (gammel render-kode + nytt slankt dataformat = «undefined»-navn og manglende koordinater), inntil grenen ble merget til `main` og pushet. Lærdom: en Sanity-migrering som forutsetter ny kode må ikke kjøres `--live` mot produksjon før koden som leser det nye formatet faktisk er deployet dit, ikke bare committet lokalt.

**Ikke gjort (Lav, bevisst utsatt):** selve `PLAN`-literalen i `itinerary.astro` (de 52 hardkodede stoppene) er ikke konvertert til `shopId`-format. Kartlegging viste at `PLAN.stops` fortsatt er i aktiv bruk to steder — fallback i `buildState()` for enhver dag uten lagret plan, og «↺ Tilbakestill»-knappen, som bygger hele planen på nytt fra `PLAN` — så en full tømming til `[]` ville vært utrygt. En fullstendig konvertering til `shopId`-format ble kartlagt og godkjent (52/52 eksakt match, samme tabell som over), men er ikke utført. Lav prioritet: i praksis rammer `PLAN.stops` nå kun et helt tomt Sanity-datasett eller et Tilbakestill-klikk, siden `itineraryState` alltid finnes og alltid vinner.

**Opprydding etter merge:** `itinerary-from-shops` merget til `main` (fast-forward) og slettet. Engangsskriptene (`backfill-itinerary-shops.ts`, `match-itinerary-stops.ts`, `migrate-itinerary-to-shops.ts`) har gjort jobben sin og er slettet. Backup-filene i `C:\Users\User\Documents\Final-Fantasy-Library\sanity-backups\` er beholdt.

---

## Service worker — nødbryter

`astro/public/sw.js` registreres nå fra `Base.astro` på **alle** sider (ikke bare `/offline`), og pre-cacher i tillegg `/checklist`, `/prices` og `/spending`. Siden den dermed er i bruk overalt, er det her en fremgangsmåte for å slå den helt av for alle brukere dersom en fremtidig endring av `sw.js` skulle vise seg å cache noe feil (f.eks. servere en utdatert eller ødelagt side offline, eller — om Cloudflare Access-sjekken i filen noen gang svikter — en innloggingsside under en av app-ens egne URL-er).

**Nødfilen ligger klar, men er ikke i bruk:** [astro/sw-kill-switch.js](astro/sw-kill-switch.js). Den har ingen `fetch`-handler i det hele tatt (alt går rett til nettverket), og i `activate` sletter den alle cacher denne origin-ens service worker noensinne har opprettet, kaller `self.registration.unregister()`, og navigerer alle åpne faner på nytt slik at de slutter å være styrt av noen som helst service worker.

**Slik slår du den av, steg for steg:**
1. Kopiér innholdet i `astro/sw-kill-switch.js` over `astro/public/sw.js` (behold gjerne den gamle `sw.js` et annet sted, eller se den i git-historikken — ikke slett den, den skal tilbake igjen i steg 4).
2. Commit og deploy som normalt. Nettlesere sjekker en registrert service worker for oppdateringer ved navigasjon (omtrent hvert 24. time, eller oftere), så det tar litt tid før alle klienter har hentet den nye `sw.js`-en — det er ikke en umiddelbar bryter for samtlige brukere i samme sekund.
3. Når en klient henter nødfilen: den installeres (`skipWaiting()`), aktiveres, tømmer alle cacher, avregistrerer seg selv, og laster hver åpen fane på nytt. Fra det punktet er det ingen service worker igjen for denne origin-en på den klienten, og sidene fungerer som om `sw.js` aldri hadde eksistert (ingen offline-støtte, men også ingen risiko for feil cachet innhold).
4. Når problemet som utløste nødbryteren er rettet: legg den ordentlige `sw.js`-en (med fiksen) tilbake på `astro/public/sw.js` og deploy igjen — en ny registrering starter helt på nytt, siden steg 3 avregistrerte den forrige.

**Om hvor fort en vanlig oppdatering av `sw.js` når brukerne (ikke nødbryteren, den normale `sw.js`):** filen kaller `self.skipWaiting()` i `install` og `self.clients.claim()` i `activate`, så en ny versjon tar over styringen av allerede åpne faner umiddelbart etter at den er installert og aktivert — uten å vente på at hver fane med den gamle versjonen skal lukkes først (standard-oppførselen uten disse to kallene). Det er en bevisst avveining: rask utrulling av fikser, mot at en fane i sjeldne tilfeller kan oppleve en ny service worker ta over midt i en pågående økt. Gitt at `fetch`-handleren er nettverk-først (cache er bare en fallback) og at ingen ømfintlig tilstand ligger i selve service workeren, vurderes dette som trygt nok til å beholde — men det er nettopp derfor nødbryteren over finnes, for den sjeldne gangen en endring i `sw.js` likevel skulle cache noe galt.
