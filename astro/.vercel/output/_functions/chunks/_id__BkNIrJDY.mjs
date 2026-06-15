import { c as createComponent } from './astro-component_BnHZLOS3.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_SxqqIqZN.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base } from './sanity_ClQvcK5c.mjs';

const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$id;
  const { id } = Astro2.params;
  const b = await sanity.fetch(
    `*[_type == "book" && _id == $id][0] { title, author, year, publisher, isbn, pages, genre, language, readStatus, readDate, ${SHARED_FIELDS} }`,
    { id }
  );
  if (!b) return Astro2.redirect("/books");
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": b.title }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="detail"> <a href="/books" style="font-size:13px;color:var(--muted)">← Books</a> <br><br> <h1>${b.title}</h1> <div class="detail-sub">${b.author}</div> ${b.photoUrl && renderTemplate`<img class="detail-photo"${addAttribute(b.photoUrl, "src")}${addAttribute(b.title, "alt")}>`} <table class="meta-table"> ${b.year && renderTemplate`<tr><td>Year</td><td>${b.year}</td></tr>`} ${b.publisher && renderTemplate`<tr><td>Publisher</td><td>${b.publisher}</td></tr>`} ${b.genre && renderTemplate`<tr><td>Genre</td><td>${b.genre}</td></tr>`} ${b.language && renderTemplate`<tr><td>Language</td><td>${b.language}</td></tr>`} ${b.pages && renderTemplate`<tr><td>Pages</td><td>${b.pages}</td></tr>`} ${b.isbn && renderTemplate`<tr><td>ISBN</td><td class="mono">${b.isbn}</td></tr>`} ${b.readStatus && renderTemplate`<tr><td>Read</td><td>${b.readStatus}</td></tr>`} ${b.readDate && renderTemplate`<tr><td>Finished</td><td>${b.readDate}</td></tr>`} ${b.status && renderTemplate`<tr><td>Ownership</td><td>${b.status}</td></tr>`} ${b.rating && renderTemplate`<tr><td>Rating</td><td class="rating">${b.rating} / 10</td></tr>`} ${b.acquiredDate && renderTemplate`<tr><td>Acquired</td><td>${b.acquiredDate}</td></tr>`} </table> ${b.tags?.length > 0 && renderTemplate`<div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap"> ${b.tags.map((t) => renderTemplate`<span class="tag">${t}</span>`)} </div>`} ${b.notes && renderTemplate`<div class="notes-block">${b.notes}</div>`} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/books/[id].astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/books/[id].astro";
const $$url = "/books/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
