import type { Page } from '@playwright/test'

// Canned responses for the three AI endpoints, used by the default (mocked) suite so it
// never costs a real Anthropic API call and never depends on network/model variance.
// tests-ai-live/ hits the real endpoints instead, deliberately without these mocks.

export async function mockIdentifyGoodResult(page: Page): Promise<void> {
  await page.route('**/api/identify-product', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          productName: 'Distant Worlds III: more music from FINAL FANTASY',
          productNameJp: null,
          jan: null,
          category: 'album',
          price: 3300,
          taxIncluded: true,
          confidence: 'high',
          notes: null,
        },
      }),
    })
  })
}

export async function mockIdentifyNoResult(page: Page): Promise<void> {
  await page.route('**/api/identify-product', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: {} }),
    })
  })
}

// Lets a test control exactly what identify-product "found", so it can be matched (or not)
// against a specific price-list fixture it just created.
export async function mockIdentifyCustomResult(page: Page, result: Record<string, unknown>): Promise<void> {
  await page.route('**/api/identify-product', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result }),
    })
  })
}

// Replaces the real barcode-scanner.js (which lazy-loads html5-qrcode and needs real camera
// access) with a stub that exposes its start() callback on window.__scannerDecode, so a test
// can simulate a decoded barcode with `page.evaluate((code) => window.__scannerDecode(code), jan)`
// instead of driving an actual camera.
export async function mockBarcodeScanner(page: Page): Promise<void> {
  await page.route('**/barcode-scanner.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.createBarcodeScanner = function (containerId) {
          let running = false
          return {
            start: function (onDecode) {
              window.__scannerDecode = onDecode
              running = true
              return Promise.resolve()
            },
            stop: function () {
              running = false
              return Promise.resolve()
            },
            isRunning: function () { return running },
          }
        }
      `,
    })
  })
}

export async function mockFindPricesResults(page: Page): Promise<void> {
  await page.route('**/api/find-prices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        results: [
          {
            store: 'CDJapan',
            price: 42.99,
            currency: 'USD',
            url: 'https://www.cdjapan.co.jp/product/TEST-FIXTURE-1',
            inStock: true,
            note: undefined,
          },
        ],
      }),
    })
  })
}

export async function mockFindPricesTwoResults(page: Page): Promise<void> {
  await page.route('**/api/find-prices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        results: [
          {
            store: 'CDJapan',
            price: 42.99,
            currency: 'USD',
            url: 'https://www.cdjapan.co.jp/product/TEST-FIXTURE-1',
            inStock: true,
            note: undefined,
          },
          {
            store: 'AmiAmi',
            price: 39.99,
            currency: 'USD',
            url: 'https://www.amiami.com/product/TEST-FIXTURE-2',
            inStock: true,
            note: undefined,
          },
        ],
      }),
    })
  })
}

export async function mockFindPricesEmpty(page: Page): Promise<void> {
  await page.route('**/api/find-prices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: [] }),
    })
  })
}

// shop-info.ts's real server-side validation (Japan bounding box/area proximity for
// coordinates, parseable openingHours, website hostname must be a seen search result) is
// mocked away by route.fulfill — these helpers return already-"validated" shaped results
// by default (the endpoint itself is unit-tested by actually calling it, not by the UI
// suite), except where a test is specifically about the UI handling a null/missing field.
export async function mockShopInfoResult(
  page: Page,
  overrides: Partial<{
    openingHours: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
    taxFreeShop: boolean | null
    website: string | null
    note: string | null
  }> = {},
  sources: { title: string; url: string }[] = [{ title: 'Example Shop — Official Site', url: 'https://example-shop.test/en' }]
): Promise<void> {
  await page.route('**/api/shop-info', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          openingHours: '10:00–20:00, closed Tue',
          address: '1-2-3 Example, Chiyoda-ku, Tokyo',
          latitude: 35.6984,
          longitude: 139.7731,
          taxFreeShop: true,
          website: 'https://example-shop.test/en',
          note: 'Known for retro games.',
          ...overrides,
        },
        sources,
      }),
    })
  })
}

export async function mockShopInfoEmpty(page: Page): Promise<void> {
  await page.route('**/api/shop-info', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { openingHours: null, address: null, latitude: null, longitude: null, taxFreeShop: null, website: null, note: null },
        sources: [],
      }),
    })
  })
}
