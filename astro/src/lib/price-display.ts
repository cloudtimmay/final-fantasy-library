// How /prices shows a price: always NOK first, with the yen equivalent alongside, using the
// same exchange rate as /spending (the default trip's jpyToNokRate — see pickDefaultTrip()
// in lib/spending.ts). Pure functions, used both for the server render (components/
// PriceProductRow.astro) and by /prices' own script when filters change which prices count.
//
//   649 NOK, rate 0.0467  -> "649 kr (≈ ¥13 900)"    (yen rounded to ¥100)
//   5980 JPY, rate 0.0467 -> "≈ 279 kr (¥5 980)"
//   42.99 USD             -> "42.99 USD"             (no conversion)
//   no rate               -> each in its own currency: "649 kr", "¥5 980"

export type DisplayPrice = { price: number; currency: string; source?: string }

const NBSP = ' ' // between thousands, and between number and unit, so a price never wraps

function group(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals)
  const [int, frac] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  const out = frac && Number(frac) !== 0 ? `${grouped}.${frac}` : grouped
  return n < 0 ? `-${out}` : out
}

const validRate = (rate: number | null | undefined): rate is number => typeof rate === 'number' && isFinite(rate) && rate > 0

// The price in NOK, or null if it can't be converted (USD/EUR, or JPY without a rate).
export function toNok(price: number, currency: string, rate?: number | null): number | null {
  if (currency === 'NOK') return price
  if (currency === 'JPY' && validRate(rate)) return price * rate
  return null
}

export function formatPriceNokFirst(price: number, currency: string, rate?: number | null): string {
  if (currency === 'NOK') {
    const kr = `${group(price, 2)}${NBSP}kr`
    if (!validRate(rate)) return kr
    return `${kr} (≈${NBSP}¥${group(Math.round(price / rate / 100) * 100)})`
  }
  if (currency === 'JPY') {
    const yen = `¥${group(price)}`
    if (!validRate(rate)) return yen
    return `≈${NBSP}${group(Math.round(price * rate))}${NBSP}kr (${yen})`
  }
  return `${group(price, 2)}${NBSP}${currency}`
}

// The cheapest of `prices`, compared in NOK. Prices that can't be converted only count if
// none of them can — then the lowest in the currency of the first (most recent) price, since
// e.g. USD and EUR can't be compared without a rate either. null for an empty list.
export function cheapestPrice<T extends DisplayPrice>(prices: T[], rate?: number | null): T | null {
  if (prices.length === 0) return null
  const convertible = prices.filter((p) => toNok(p.price, p.currency, rate) !== null)
  if (convertible.length) {
    return convertible.reduce((best, p) => (toNok(p.price, p.currency, rate)! < toNok(best.price, best.currency, rate)! ? p : best))
  }
  const sameCurrency = prices.filter((p) => p.currency === prices[0].currency)
  return sameCurrency.reduce((best, p) => (p.price < best.price ? p : best))
}

// The collapsed product row's price line: the cheapest price and where it is, plus how many
// other prices there are — e.g. { text: "649 kr (≈ ¥13 900) · Outland", more: 2 }.
export function cheapestLine(prices: DisplayPrice[], rate?: number | null): { text: string; more: number } | null {
  const cheapest = cheapestPrice(prices, rate)
  if (!cheapest) return null
  const where = cheapest.source ? ` · ${cheapest.source}` : ''
  return { text: formatPriceNokFirst(cheapest.price, cheapest.currency, rate) + where, more: prices.length - 1 }
}
