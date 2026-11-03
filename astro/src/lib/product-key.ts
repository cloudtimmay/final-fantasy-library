// The one grouping key used everywhere a priceEntry needs to be clustered into a
// "product": the JAN if present, otherwise the trimmed/lowercased product name.
// Both add-price.astro and prices.astro must use this exact function so a price
// logged from either page always lands in the same product group.
//
// On its own (no Sanity client) so pure modules and tests can use it; price-products.ts
// re-exports it.
export function productKey(jan: string | undefined | null, productName: string | undefined | null): string {
  const j = String(jan || '').trim()
  if (j) return j
  return String(productName || '').trim().toLowerCase()
}
