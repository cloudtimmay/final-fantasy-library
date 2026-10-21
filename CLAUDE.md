# CLAUDE.md

Standing instructions for every Claude Code session in this repo.

## Project

Final Fantasy Library — a personal collection tracker (albums/games/books/merchandise) and Japan trip planner. Astro app deployed on Vercel, content in Sanity (project `ip4i779g`). The live site sits behind Cloudflare Zero Trust.

- Repo root: `C:\dev\final-fantasy-library` (contains `astro/`, `sanity/`, `scripts/`)
- Sanity dataset backups (outside the repo, never committed): `C:\Users\User\Documents\Final-Fantasy-Library\sanity-backups\`

## Workflow

- Windows + PowerShell. No `&&` command chaining — use `;` or separate lines.
- Local dev and all Playwright tests run against the Sanity `development` dataset (a copy of production) — never write to `production`. Two independent guards already enforce this (`astro/tests/guard-dataset.mjs`, `astro/tests/global-setup.ts`); never bypass or weaken them.
- After any change: run the relevant spec(s), then the full Playwright suite.
- Make a LOCAL git commit only when tests pass. One change per commit.
- Never `git push` — Kim pushes.
- Never run `sanity deploy` — Kim deploys schema changes himself.
- Always respond in English.
- Report, every time: commit hash(es), test results, anything not tested, and `git status`.
- Ask before deleting anything. Be honest about trade-offs — don't paper over a limitation or a known risk.

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
