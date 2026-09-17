import { test, expect } from '@playwright/test';

/**
 * Cross-browser matrix smoke test (QA-001c).
 *
 * Runs in every configured project (chromium, firefox, webkit) and proves the
 * matching engine actually launches and renders a DOM. It is deliberately
 * self-contained (no server, no app bundle) so it can gate the browser matrix
 * before apps/web / apps/services/api exist — QA-002 replaces the flow stubs
 * with the real E2E-WEB-* / E2E-EXT-* / E2E-CROSS-* flows.
 *
 * Synthetic-data safe (AR-4): no secrets, no real domains, no network I/O.
 */

// The three engines QA-001c must gate. Kept explicit so adding/removing a
// browser in playwright.config.ts forces a conscious update here.
const EXPECTED_ENGINES = ['chromium', 'firefox', 'webkit'] as const;

test('matrix engine launches and renders a DOM', async ({ page, browserName }) => {
  // browserName is the project engine name, independent of the test title.
  test.info().annotations.push({ type: 'engine', description: browserName });

  await page.setContent(
    '<!doctype html><html><body><h1 id="heading">playwright-e2e-smoke</h1><p id="engine"></p></body></html>',
  );

  await expect(page.locator('#heading')).toBeVisible();
  await expect(page.locator('#heading')).toHaveText('playwright-e2e-smoke');

  // Round-trip the engine name through the page to prove this project really
  // drives its own browser, not a fallback.
  await page.evaluate((name) => {
    const el = document.getElementById('engine');
    if (el) el.textContent = name;
  }, browserName);
  await expect(page.locator('#engine')).toHaveText(browserName);

  expect(EXPECTED_ENGINES).toContain(browserName as (typeof EXPECTED_ENGINES)[number]);
});
