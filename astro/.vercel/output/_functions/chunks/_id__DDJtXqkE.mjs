import { c as createComponent } from './astro-component_CjUB1-_k.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_DCA-xERg.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base, u as urlFor } from './sanity_JB9bNtQd.mjs';

const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$id;
  const { id } = Astro2.params;
  const f = await sanity.fetch(
    `*[_type == "figure" && _id == $id][0] { title, series, manufacturer, year, scale, condition, location, ${SHARED_FIELDS} }`,
    { id }
  );
  if (!f) return Astro2.redirect("/figures");
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": f.title }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="detail"> <a href="/figures" style="font-size:13px;color:var(--muted)">← Figures</a> <br><br> <h1>${f.title}</h1> <div class="detail-sub">${f.series}</div> ${f.image && renderTemplate`<img class="detail-photo"${addAttribute(urlFor(f.image).width(900).url(), "src")}${addAttribute(f.title, "alt")}>`} <table class="meta-table"> ${f.manufacturer && renderTemplate`<tr><td>Manufacturer</td><td>${f.manufacturer}</td></tr>`} ${f.year && renderTemplate`<tr><td>Year</td><td>${f.year}</td></tr>`} ${f.scale && renderTemplate`<tr><td>Scale</td><td>${f.scale}</td></tr>`} ${f.condition && renderTemplate`<tr><td>Condition</td><td>${f.condition}</td></tr>`} ${f.location && renderTemplate`<tr><td>Location</td><td>${f.location}</td></tr>`} ${f.status && renderTemplate`<tr><td>Status</td><td>${f.status}</td></tr>`} ${f.rating && renderTemplate`<tr><td>Rating</td><td class="rating">${f.rating} / 10</td></tr>`} ${f.acquiredDate && renderTemplate`<tr><td>Acquired</td><td>${f.acquiredDate}</td></tr>`} ${f.purchasePrice && renderTemplate`<tr><td>Paid</td><td>${f.purchasePrice} NOK</td></tr>`} </table> ${f.tags?.length > 0 && renderTemplate`<div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap"> ${f.tags.map((t) => renderTemplate`<span class="tag">${t}</span>`)} </div>`} ${f.notes && renderTemplate`<div class="notes-block">${f.notes}</div>`} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/figures/[id].astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/figures/[id].astro";
const $$url = "/figures/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
