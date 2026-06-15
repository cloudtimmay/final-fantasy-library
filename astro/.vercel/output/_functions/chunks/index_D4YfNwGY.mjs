import { c as createComponent } from './astro-component_CjUB1-_k.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_DCA-xERg.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base, u as urlFor } from './sanity_JB9bNtQd.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const figures = await sanity.fetch(`
  *[_type == "figure"] | order(series asc, title asc) {
    _id, title, series, manufacturer, year, scale, condition, ${SHARED_FIELDS}
  }
`);
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Figures" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="page-header"> <h1>Figures</h1> <span class="count">${figures.length} items</span> </div> <div class="grid"> ${figures.map((f) => renderTemplate`<a class="card"${addAttribute(`/figures/${f._id}`, "href")}> ${f.image ? renderTemplate`<img class="card-photo"${addAttribute(urlFor(f.image).height(180).url(), "src")}${addAttribute(f.title, "alt")} loading="lazy">` : renderTemplate`<div class="card-photo-placeholder">🗿</div>`} <div class="card-title">${f.title}</div> <div class="card-sub">${f.series}${f.manufacturer ? ` · ${f.manufacturer}` : ""}</div> <div class="card-meta"> <span${addAttribute(`status-dot ${f.status}`, "class")}></span> ${f.scale && renderTemplate`<span class="tag">${f.scale}</span>`} ${f.rating && renderTemplate`<span class="rating">${f.rating}/10</span>`} </div> </a>`)} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/figures/index.astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/figures/index.astro";
const $$url = "/figures";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
