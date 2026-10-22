// A Sanity CDN image URL at a given width, for places that only have the asset's plain URL
// (priceEntry/product images, which aren't built with urlFor()): the CDN resizes it
// (fit=max: never larger than the stored image) and sends the best format the browser takes
// (auto=format). Safe in both server and client code — no Sanity client needed.
export function cdnImage(url: string, width: number): string
export function cdnImage(url: string | null | undefined, width: number): string | null
export function cdnImage(url: string | null | undefined, width: number): string | null {
  if (!url) return null
  if (!/^https:\/\/cdn\.sanity\.io\/images\//.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}&fit=max&auto=format`
}
