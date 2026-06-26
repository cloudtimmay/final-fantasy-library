import type { APIRoute } from 'astro'

export const prerender = false

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

// Pull the first capture group of a regex, trimmed, or '' if no match.
function grab(html: string, re: RegExp): string {
  const m = html.match(re)
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : ''
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url).searchParams.get('url') || ''

  // Only allow real MFC item URLs.
  if (!/^https:\/\/(www\.)?myfigurecollection\.net\/item\/\d+/.test(url)) {
    return json(400, { error: 'Provide a valid MFC item URL (…/item/1457)' })
  }

  let html: string
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Upgrade-Insecure-Requests': '1',
      },
    })
    if (!res.ok) return json(502, { error: `MFC returned ${res.status}` })
    html = await res.text()
  } catch (e: any) {
    return json(502, { error: 'Could not reach MFC (it may be blocking the request).' })
  }

  // --- Parse fields from the item page ---
  // Title: og:title is the cleanest source.
  let title = grab(html, /<meta property="og:title" content="([^"]+)"/)
  title = title.replace(/\s*-\s*MyFigureCollection.*$/i, '').trim()

  // Main image.
  const externalImageUrl = grab(html, /<meta property="og:image" content="([^"]+)"/)

  // Data rows: MFC uses <a class="item-... data-field="origin|companies|...">.
  // These selectors target the labelled data blocks shown on the item page.
  const series = grab(html, /data-field="origin"[^>]*>([^<]+)</i)
  const manufacturer = grab(html, /data-field="companies"[^>]*>([^<]+)</i)

  // Release year: first 4-digit year near the "Releases" / date area.
  const yearStr = grab(html, /data-field="releases?"[\s\S]{0,200}?(\d{4})/i)
    || (html.match(/(\d{4})\/\d{2}\b/) || [])[1] || ''
  const year = yearStr ? Number(yearStr) : undefined

  if (!title) {
    return json(404, { error: 'Could not parse this page. MFC may have changed its layout.' })
  }

  return json(200, { title, series, manufacturer, year, externalImageUrl, source: url })
}