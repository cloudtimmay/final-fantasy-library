import { c as createComponent } from './astro-component_CjUB1-_k.mjs';
import 'piccolore';
import { o as renderComponent, k as renderTemplate, m as maybeRenderHead, h as addAttribute } from './entrypoint_DCA-xERg.mjs';
import { s as sanity, $ as $$Base, u as urlFor } from './sanity_JB9bNtQd.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const [albumCount, gameCount, figureCount, bookCount] = await Promise.all([
    sanity.fetch(`count(*[_type == "album"])`),
    sanity.fetch(`count(*[_type == "game"])`),
    sanity.fetch(`count(*[_type == "figure"])`),
    sanity.fetch(`count(*[_type == "book"])`)
  ]);
  const recentlyAdded = await sanity.fetch(`
  *[_type in ["album","game","figure","book"]] | order(_createdAt desc) [0..7] {
    _id, _type, title,
    "sub": select(
      _type == "album" => artist,
      _type == "game"  => platform[0],
      _type == "figure"=> series,
      _type == "book"  => author
    ),
    status, rating, image
  }
`);
  return renderTemplate`${renderComponent($$result, "Base", $$Base, { "title": "Dashboard" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="page-header"> <h1>My Collection</h1> </div> <div class="stats-grid"> <a href="/albums" class="stat-card"> <div class="num">${albumCount}</div> <div class="label">🎵 Albums</div> </a> <a href="/games" class="stat-card"> <div class="num">${gameCount}</div> <div class="label">🎮 Games</div> </a> <a href="/figures" class="stat-card"> <div class="num">${figureCount}</div> <div class="label">🗿 Figures</div> </a> <a href="/books" class="stat-card"> <div class="num">${bookCount}</div> <div class="label">📚 Books</div> </a> <div class="stat-card"> <div class="num">${albumCount + gameCount + figureCount + bookCount}</div> <div class="label">Total items</div> </div> </div> <div class="page-header"> <h2 style="font-size:1rem;font-weight:600">Recently added</h2> </div> <div class="grid"> ${recentlyAdded.map((item) => renderTemplate`<a class="card"${addAttribute(`/${item._type}s/${item._id}`, "href")}> ${item.image ? renderTemplate`<img class="card-photo"${addAttribute(urlFor(item.image).height(180).url(), "src")}${addAttribute(item.title, "alt")} loading="lazy">` : renderTemplate`<div class="card-photo-placeholder"> ${item._type === "album" && "🎵"} ${item._type === "game" && "🎮"} ${item._type === "figure" && "🗿"} ${item._type === "book" && "📚"} </div>`} <div class="card-title">${item.title}</div> ${item.sub && renderTemplate`<div class="card-sub">${item.sub}</div>`} <div class="card-meta"> <span${addAttribute(`status-dot ${item.status}`, "class")}></span> ${item.rating && renderTemplate`<span class="rating">${item.rating}/10</span>`} </div> </a>`)} </div> ` })}`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/index.astro", void 0);

const $$file = "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
