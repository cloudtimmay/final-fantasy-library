import { c as createComponent } from './astro-component_BUmeO1Ke.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_DV6VN_mz.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base } from './sanity_BF1UB-_o.mjs';

async function getStaticPaths() {
  const albums = await sanity.fetch(`
    *[_type == "album"]{ _id }
  `);
  return albums.map((album) => ({
    params: { id: album._id }
  }));
}
const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$id;
  const { id } = Astro2.params;
  const a = await sanity.fetch(
    `*[_type == "album" && _id == $id][0] { title, artist, year, genre, format, label, ${SHARED_FIELDS} }`,
    { id }
  );
  if (!a) return Astro2.redirect("/albums");
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": a.title }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="detail"> <a href="/albums" style="font-size:13px;color:var(--muted)">← Albums</a> <br><br> <h1>${a.title}</h1> <div class="detail-sub">${a.artist}</div> ${a.photoUrl && renderTemplate`<img class="detail-photo"${addAttribute(a.photoUrl, "src")}${addAttribute(a.title, "alt")}>`} <table class="meta-table"> ${a.year && renderTemplate`<tr><td>Year</td><td>${a.year}</td></tr>`} ${a.genre && renderTemplate`<tr><td>Genre</td><td>${a.genre}</td></tr>`} ${a.format && renderTemplate`<tr><td>Format</td><td>${a.format}</td></tr>`} ${a.label && renderTemplate`<tr><td>Label</td><td>${a.label}</td></tr>`} ${a.status && renderTemplate`<tr><td>Status</td><td>${a.status}</td></tr>`} ${a.rating && renderTemplate`<tr><td>Rating</td><td class="rating">${a.rating} / 10</td></tr>`} ${a.acquiredDate && renderTemplate`<tr><td>Acquired</td><td>${a.acquiredDate}</td></tr>`} ${a.purchasePrice && renderTemplate`<tr><td>Paid</td><td>${a.purchasePrice} NOK</td></tr>`} </table> ${a.tags?.length > 0 && renderTemplate`<div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap"> ${a.tags.map((t) => renderTemplate`<span class="tag">${t}</span>`)} </div>`} ${a.notes && renderTemplate`<div class="notes-block">${a.notes}</div>`} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/albums/[id].astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/albums/[id].astro";
const $$url = "/albums/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
