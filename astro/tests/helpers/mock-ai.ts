import type { Page } from '@playwright/test'

// Canned responses for the two AI endpoints, used by the default (mocked) suite so it
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

export async function mockFindPricesEmpty(page: Page): Promise<void> {
  await page.route('**/api/find-prices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: [] }),
    })
  })
}
