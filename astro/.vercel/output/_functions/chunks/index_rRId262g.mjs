import { c as createComponent } from './astro-component_BUmeO1Ke.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_DV6VN_mz.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base } from './sanity_BF1UB-_o.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const books = await sanity.fetch(`
  *[_type == "book"] | order(author asc, title asc) {
    _id, title, author, year, genre, readStatus, ${SHARED_FIELDS}
  }
`);
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Books" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="page-header"> <h1>Books</h1> <span class="count">${books.length} items</span> </div> <div class="grid"> ${books.map((b) => renderTemplate`<a class="card"${addAttribute(`/books/${b._id}`, "href")}> ${b.photoUrl ? renderTemplate`<img class="card-photo"${addAttribute(b.photoUrl, "src")}${addAttribute(b.title, "alt")} loading="lazy">` : renderTemplate`<div class="card-photo-placeholder">📚</div>`} <div class="card-title">${b.title}</div> <div class="card-sub">${b.author}${b.year ? ` · ${b.year}` : ""}</div> <div class="card-meta"> <span${addAttribute(`status-dot ${b.status}`, "class")}></span> ${b.readStatus && renderTemplate`<span class="tag">${b.readStatus}</span>`} ${b.rating && renderTemplate`<span class="rating">${b.rating}/10</span>`} </div> </a>`)} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/books/index.astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/books/index.astro";
const $$url = "/books";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
