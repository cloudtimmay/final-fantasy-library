import { c as createComponent } from './astro-component_REbGpXh6.mjs';
import 'piccolore';
import { p as renderHead, q as renderSlot, k as renderTemplate } from './entrypoint_BOsG7h9O.mjs';
import 'clsx';
import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';

const $$Base = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Base;
  const { title = "My Collection" } = Astro2.props;
  return renderTemplate`<html lang="en"> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} — Collection</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">${renderHead()}</head> <body> <nav> <a href="/" class="nav-brand">Collection</a> <a href="/albums">Albums</a> <a href="/games">Games</a> <a href="/figures">Figures</a> <a href="/books">Books</a> </nav> <main> ${renderSlot($$result, $$slots["default"])} </main> </body></html>`;
}, "C:/Users/kim_r/OneDrive/Ymse/Programming/VSudio/Final Fantasy Library/collection-registry/astro/src/layouts/Base.astro", void 0);

const sanity = createClient({
  projectId: "ip4i779g",
  dataset: "production",
  useCdn: false,
  apiVersion: "2024-01-01"
});
const builder = imageUrlBuilder(sanity);
function urlFor(source) {
  return builder.image(source);
}
const SHARED_FIELDS = `status, rating, tags, image, acquiredDate, purchasePrice, notes`;

export { $$Base as $, SHARED_FIELDS as S, sanity as s, urlFor as u };
