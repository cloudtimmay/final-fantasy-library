import { c as createComponent } from './astro-component_BnHZLOS3.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_SxqqIqZN.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base } from './sanity_ClQvcK5c.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const games = await sanity.fetch(`
  *[_type == "game"] | order(title asc) {
    _id, title, developer, year, platform, genre, completionStatus, ${SHARED_FIELDS}
  }
`);
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Games" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="page-header"> <h1>Games</h1> <span class="count">${games.length} items</span> </div> <div class="grid"> ${games.map((g) => renderTemplate`<a class="card"${addAttribute(`/games/${g._id}`, "href")}> ${g.photoUrl ? renderTemplate`<img class="card-photo"${addAttribute(g.photoUrl, "src")}${addAttribute(g.title, "alt")} loading="lazy">` : renderTemplate`<div class="card-photo-placeholder">🎮</div>`} <div class="card-title">${g.title}</div> <div class="card-sub">${g.platform?.join(", ")}${g.year ? ` · ${g.year}` : ""}</div> <div class="card-meta"> <span${addAttribute(`status-dot ${g.status}`, "class")}></span> ${g.completionStatus && renderTemplate`<span class="tag">${g.completionStatus}</span>`} ${g.rating && renderTemplate`<span class="rating">${g.rating}/10</span>`} </div> </a>`)} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/games/index.astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/games/index.astro";
const $$url = "/games";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
