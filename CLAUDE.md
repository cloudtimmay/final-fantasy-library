# CLAUDE.md

Standing instructions for every Claude Code session in this repo.

## Project

Final Fantasy Library — a personal collection tracker (albums/games/books/merchandise) and Japan trip planner. Astro app deployed on Vercel, content in Sanity (project `ip4i779g`). The live site sits behind Cloudflare Zero Trust.

- Repo root: `C:\dev\final-fantasy-library` (contains `astro/`, `sanity/`, `scripts/`)
- Sanity dataset backups (outside the repo, never committed): `C:\Users\User\Documents\Final-Fantasy-Library\sanity-backups\`

## Workflow

- Windows + PowerShell. No `&&` command chaining — use `;` or separate lines.
- Local dev and all Playwright tests run against the Sanity `development` dataset (a copy of production) — never write to `production`. Two independent guards already enforce this (`astro/tests/guard-dataset.mjs`, `astro/tests/global-setup.ts`); never bypass or weaken them.
- Testing (see **Testing** below): related specs during a task, the full suite once at the end.
- Make a LOCAL git commit only when tests pass. One change per commit.
- Never `git push` — Kim pushes.
- Never run `sanity deploy` — Kim deploys schema changes himself.
- Always respond in English.
- Report, every time: commit hash(es), test results and how long the test runs took, anything not tested, and `git status`.
- Ask before deleting anything. Be honest about trade-offs — don't paper over a limitation or a known risk.

## Testing

- During a task, run only the specs related to what you changed (`npx playwright test <spec>…`).
- Commit each step locally once its related specs pass.
- Run the full suite once at the end of the task, before the final report — not after every step.
- Exception: a step that changes `Base.astro`, `sw.js`, a shared module in `src/lib/`, or a shared `public/*.js` script gets the full suite before that step's commit.
- No live requests to real stores or the real AI API unless Kim asks for it. Use mocks and saved HTML/JSON samples.
- Report how long each test run took.
- The suite runs in parallel (4 workers, `fullyParallel`; `PW_WORKERS=1` for a serial run) against the one shared `development` dataset, and reuses an already running dev server (`npm run dev:test`). Not more than 4: at 6, Sanity's per-IP write rate limit made a different test fail on most full runs. That is only safe because every test touches nothing but its own fixtures:
  - names start with `[test] ` (`testName()`), and documents are deleted with `trackDoc()`
  - barcodes/ISBNs written to Sanity come from `uniqueJan()`, never a hard-coded code — price entries group by JAN, so a shared code makes parallel tests see each other's data
  - pages that pick a trip get it explicitly (`?trip=<id>`)
  - anything that writes shared data (e.g. the itinerary autosave to `/api/itinerary-save`) is mocked
  - no fixed waits (`waitForTimeout`) — wait for a state, or use `page.clock` for debounces; to keep a mocked request "in flight", hold it until the test releases it, never a fixed delay
  - find a product row by its name element (`.summary-name`), not `hasText` on the whole row — another row's "Possible duplicate of <name>" note contains that name too
  - no bare `page.locator('h1')` — Astro's dev toolbar adds its own `<h1>`s; use `getByRole('heading', { name })`

## Lessons learned (do not repeat these)

- **Sanity data is global** — dev and prod share the same schema once it's deployed. Deploy code that *reads* a data shape change before writing data in that new shape; deploy a schema change before the code that depends on its new fields.
- **Service worker caching** is network-first with a "saved copy" age banner on stale pages. There's a documented kill switch in CLEANUP.md if a bad `sw.js` ever needs to be pulled back.
- **Astro's scoped CSS never applies to elements built in a `<script>`** (`document.createElement`, `innerHTML`) — including the innermost element of a descendant selector, even when the outer element is written statically in the template. Any class used on a JS-built element must live in a `<style is:global>` block, prefixed per page (e.g. `ap-`, `idf-`, `aif-`) to avoid collisions with other pages.
- **An author CSS rule that sets an unconditional `display` always beats the `[hidden]` attribute's default `display: none`**, regardless of selector specificity. Any class that both sets `display` and is toggled via `.hidden`/`[hidden]` needs an explicit `{selector}[hidden] { display: none; }` override — this bug has recurred multiple times across this project.
- **No `position: sticky` + `backdrop-filter` together in `Base.astro`** — causes a black screen on mobile.
- **`<option>.hidden` does not work in iOS Safari.** Don't hide `<option>` elements that way — rebuild the `<select>`'s options instead.
- **`_type: "figure"` is always displayed to the user as "Merchandise"** — the schema/type name and the user-facing label differ on purpose; don't "fix" this.
- **Sanity's `options.list` is a Studio UI suggestion, not validation.** Any field with a fixed set of values must be validated server-side too, using the shared whitelist in the relevant lib module (`collection-fields.ts`, `price-entry-fields.ts`) — never trust a raw value from the client.
- **AI endpoints** (`identify-product.ts`, `shop-info.ts`, `item-info.ts`, `find-prices.ts`, `itinerary-review.ts`): model name as one named constant; parse the response defensively (a "thinking" block can precede the actual answer — don't assume the first content block is it); validate every field of the result before using it; a URL from a web search is only trusted if its hostname actually appeared in the search results, never taken from model text alone; always mock these endpoints in Playwright tests, never call the real API from the default suite.

## Conventions

Reuse the shared modules that already exist — don't duplicate their logic:

- `astro/src/lib/api.ts` — `json()`, `parseJsonBody()`, `buildDoc()`, `buildPatch()`
- `astro/src/lib/price-entry-fields.ts` — `PEOPLE_LIST`, `OWNER`, price-entry enums
- `astro/src/lib/collection-fields.ts` — album/game/book/figure enums, `IMPORTANT_FIELDS`, `missingImportantFields()`
- `astro/src/lib/price-products.ts`, `spending.ts`, `spending-grouping.ts`, `product-match.ts`, `route-optimizer.ts`
- `astro/public/*.js` — `identify-flow.js`, `item-info-flow.js`, `barcode-scanner.js`, `resize-image.js`, `trip-select.js`

Other rules:

- `OWNER` and `PEOPLE_LIST` live in exactly one place (`price-entry-fields.ts`, mirrored in `sanity/schemaTypes/peopleList.ts`) — don't redefine them elsewhere.
- One change per commit.
- Ask before deleting anything.
- Be honest about trade-offs, limitations, and anything left untested.

## Known debt / pending work

See `CLEANUP.md` for the full list of known issues, deliberate trade-offs, and tracked-but-not-yet-done work.
