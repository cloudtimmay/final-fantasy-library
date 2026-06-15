import { c as createComponent } from './astro-component_BUmeO1Ke.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_DV6VN_mz.mjs';
import { s as sanity, S as SHARED_FIELDS, $ as $$Base } from './sanity_BF1UB-_o.mjs';

async function getStaticPaths() {
  const games = await sanity.fetch(`
    *[_type == "game"]{ _id }
  `);
  return games.map((game) => ({
    params: { id: game._id }
  }));
}
const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$id;
  const { id } = Astro2.params;
  const g = await sanity.fetch(
    `*[_type == "game" && _id == $id][0] { title, developer, publisher, year, platform, genre, completionStatus, playtimeHours, ${SHARED_FIELDS} }`,
    { id }
  );
  if (!g) return Astro2.redirect("/games");
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": g.title }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="detail"> <a href="/games" style="font-size:13px;color:var(--muted)">← Games</a> <br><br> <h1>${g.title}</h1> <div class="detail-sub">${g.developer}</div> ${g.photoUrl && renderTemplate`<img class="detail-photo"${addAttribute(g.photoUrl, "src")}${addAttribute(g.title, "alt")}>`} <table class="meta-table"> ${g.year && renderTemplate`<tr><td>Year</td><td>${g.year}</td></tr>`} ${g.platform?.length && renderTemplate`<tr><td>Platform</td><td>${g.platform.join(", ")}</td></tr>`} ${g.genre && renderTemplate`<tr><td>Genre</td><td>${g.genre}</td></tr>`} ${g.publisher && renderTemplate`<tr><td>Publisher</td><td>${g.publisher}</td></tr>`} ${g.completionStatus && renderTemplate`<tr><td>Progress</td><td>${g.completionStatus}</td></tr>`} ${g.playtimeHours && renderTemplate`<tr><td>Playtime</td><td>${g.playtimeHours}h</td></tr>`} ${g.status && renderTemplate`<tr><td>Status</td><td>${g.status}</td></tr>`} ${g.rating && renderTemplate`<tr><td>Rating</td><td class="rating">${g.rating} / 10</td></tr>`} ${g.acquiredDate && renderTemplate`<tr><td>Acquired</td><td>${g.acquiredDate}</td></tr>`} </table> ${g.tags?.length > 0 && renderTemplate`<div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap"> ${g.tags.map((t) => renderTemplate`<span class="tag">${t}</span>`)} </div>`} ${g.notes && renderTemplate`<div class="notes-block">${g.notes}</div>`} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/games/[id].astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/games/[id].astro";
const $$url = "/games/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
