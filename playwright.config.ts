import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration — QA-001c.
 *
 * Browser matrix (TEST_STRATEGY.md §3.4): Chromium, Firefox, WebKit.
 * A dedicated Firefox MV3-extension project is stubbed below and activates once
 * `apps/browser-firefox/dist` exists (BR-* tasks); see tests/e2e/README.md.
 *
 * Artifacts (TEST_STRATEGY.md §9, §11): trace/screenshot/video are retained on
 * failure only; the HTML report lands in playwright-report/ and raw artifacts in
 * test-results/ (both git-ignored, uploaded by QA-001g).
 *
 * Flake policy (TEST_STRATEGY.md §10): retries are forced to 0 so a flaky test
 * surfaces as a P1 defect instead of being silently retried in CI.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // no silent retries — flake policy §10
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/report.json' }],
  ],
  outputDir: 'test-results',
  use: {
    // Set E2E_BASE_URL to point at a built web bundle (production mode, not the
    // dev server) once apps/web ships; the matrix smoke test does not need it.
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Firefox MV3-extension project (TEST_STRATEGY.md §3.4.2). Activated once
    // apps/browser-firefox builds to dist/. Load the packaged extension via a
    // launch profile / --install-addon, then point testDir at tests/e2e/extension.
    // {
    //   name: 'firefox-extension',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     launchOptions: {
    //       firefoxUserPrefs: {
    //         // MV3 extensions load in a dedicated Firefox profile; see README.
    //       },
    //     },
    //   },
    // },
  ],
});
