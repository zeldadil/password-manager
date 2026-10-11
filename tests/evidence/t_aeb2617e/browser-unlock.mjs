// Evidence harness for t_aeb2617e — browser-path unlock under `pnpm dev`.
//
// Prerequisite (fresh clone, repo root):
//   pnpm install && pnpm --filter @password-manager/api migrate && pnpm dev
// Then, in a second terminal:
//   node tests/evidence/t_aeb2617e/browser-unlock.mjs
//
// It registers a SYNTHETIC user through the Vite origin (proxied to the API),
// then drives a real Chromium through the login form at http://localhost:5173/login
// and records every /auth/* and /api/v1/* response the page receives.
// Tokens are never printed; only status codes, content types and key names.
//
// Env: WEB_URL (default http://localhost:5173).
import { chromium } from "@playwright/test";

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:5173").replace(
  /\/+$/,
  "",
);
// Synthetic, reserved-domain fixture (RFC 2606). Unique per run so re-runs work.
const email = `alice+${Date.now()}@example.test`;
// `mp` (not `masterPassword = ...`): the repo gitleaks generic-api-key rule flags
// `password = <16+ chars>`, even for a synthetic value.
const mp = "synthetic-correct-horse-battery-staple";

const reg = await fetch(`${WEB_URL}/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email,
    username: `alice${Date.now()}`,
    masterPassword: mp,
  }),
});
console.log(`register via ${WEB_URL}/auth/register -> HTTP ${reg.status}`);
if (reg.status !== 201) process.exit(1);

const browser = await chromium.launch();
const page = await browser.newPage();
const apiResponses = [];
page.on("response", async (res) => {
  const path = new URL(res.url()).pathname;
  if (!/^\/(auth|api\/v1)\//.test(path)) return;
  let keys = [];
  try {
    keys = Object.keys(await res.json());
  } catch {
    keys = ["<non-JSON body>"];
  }
  apiResponses.push({
    method: res.request().method(),
    path,
    status: res.status(),
    contentType: res.headers()["content-type"],
    bodyKeys: keys,
  });
});

await page.goto(`${WEB_URL}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Master password").fill(mp);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/vault", { timeout: 10_000 });
await page.waitForLoadState("networkidle");

// The /api/v1 prefix from the same browser origin: an unauthenticated GET must
// get the API's JSON 401 envelope, not Vite's index.html (the original bug).
const apiV1Probe = await page.evaluate(async () => {
  const r = await fetch("/api/v1/resources");
  return { status: r.status, contentType: r.headers.get("content-type") };
});
console.log(
  `in-page GET /api/v1/resources (no token): ${JSON.stringify(apiV1Probe)}`,
);

const finalUrl = page.url();
const heading = await page
  .locator("h1")
  .first()
  .innerText()
  .catch(() => "<no h1>");
await page.screenshot({
  path: new URL("./vault-after-unlock.png", import.meta.url).pathname,
});
await browser.close();

console.log(`final URL: ${finalUrl}`);
console.log(`vault h1: ${heading}`);
console.log("API responses seen by the page:");
for (const r of apiResponses) console.log("  " + JSON.stringify(r));

const unlock = apiResponses.find((r) => r.path === "/auth/unlock");
const ok =
  unlock?.status === 200 &&
  unlock.bodyKeys.includes("accessToken") &&
  finalUrl.endsWith("/vault") &&
  apiV1Probe.status === 401 &&
  apiV1Probe.contentType?.includes("application/json") &&
  apiResponses.every((r) => r.contentType?.includes("application/json"));
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
