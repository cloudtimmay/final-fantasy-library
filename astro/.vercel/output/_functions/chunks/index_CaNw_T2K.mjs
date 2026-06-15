import { c as createComponent } from './astro-component_BAQMmx7-.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_BWbJ2HoB.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base } from './sanity_DKpCMIs6.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const albums = await sanity.fetch(`
  *[_type == "album"] | order(artist asc, title asc) {
    _id, title, artist, year, genre, format, ${SHARED_FIELDS}
  }
`);
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Albums" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="page-header"> <h1>Albums</h1> <span class="count">${albums.length} items</span> </div> <div class="grid"> ${albums.map((a) => renderTemplate`<a class="card"${addAttribute(`/albums/${a._id}`, "href")}> ${a.photoUrl ? renderTemplate`<img class="card-photo"${addAttribute(a.photoUrl, "src")}${addAttribute(a.title, "alt")} loading="lazy">` : renderTemplate`<div class="card-photo-placeholder">🎵</div>`} <div class="card-title">${a.title}</div> <div class="card-sub">${a.artist}${a.year ? ` · ${a.year}` : ""}</div> <div class="card-meta"> <span${addAttribute(`status-dot ${a.status}`, "class")}></span> ${a.format && renderTemplate`<span class="tag">${a.format}</span>`} ${a.rating && renderTemplate`<span class="rating">${a.rating}/10</span>`} </div> </a>`)} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/albums/index.astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/albums/index.astro";
const $$url = "/albums";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
