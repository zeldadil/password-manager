// QA probe for t_be28372f: checks the doc claims about the browser path under `pnpm dev`.
// README Quick Start / setup.md §7.3, §8 step 5 claim:
//   - unlock at /login -> POST /auth/unlock 200 -> lands on /vault
//   - /vault shows Lock and Account buttons
//   - the Vault page stays on "Loading resources…" (t_76755bb3), because the
//     unbound fetch throws "Illegal invocation" before any GET /api/v1/resources.
// Synthetic data only (RFC 2606 domain). Tokens are never printed.
// Run from the repo root of a clone (resolves @playwright/test from there).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { chromium } = require("@playwright/test");

const WEB_URL = "http://localhost:5173";
const stamp = Date.now();
const email = `qa.docs+${stamp}@example.test`;
const mp = "synthetic-docs-check-battery-staple";

const reg = await fetch(`${WEB_URL}/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, username: `qadocs${stamp}`, masterPassword: mp }),
});
console.log(`register via :5173 -> HTTP ${reg.status}`);
if (reg.status !== 201) process.exit(1);

const browser = await chromium.launch();
const page = await browser.newPage();
const reqs = [];
const resps = [];
const errors = [];
page.on("request", (r) => {
  const p = new URL(r.url()).pathname;
  if (/^\/(auth|api\/v1)\//.test(p)) reqs.push(`${r.method()} ${p}`);
});
page.on("response", (r) => {
  const p = new URL(r.url()).pathname;
  if (/^\/(auth|api\/v1)\//.test(p)) resps.push(`${r.request().method()} ${p} ${r.status()}`);
});
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${WEB_URL}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Master password").fill(mp);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/vault", { timeout: 10_000 });
await page.waitForTimeout(6000); // give the Vault page time to (not) load resources

const url = page.url();
const lockBtn = await page.getByRole("button", { name: /lock/i }).count();
const accountBtn = await page.getByRole("button", { name: /account/i }).count();
const loading = await page.getByText("Loading resources…").count();
const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400);
await page.screenshot({ path: new URL("./vault-6s-after-unlock.png", import.meta.url).pathname });
await browser.close();

const resourcesGet = reqs.filter((r) => r.startsWith("GET /api/v1/resources")).length;
const illegal = errors.some((e) => /Illegal invocation/i.test(e));
console.log(`final URL: ${url}`);
console.log(`requests by page: ${JSON.stringify(reqs)}`);
console.log(`responses: ${JSON.stringify(resps)}`);
console.log(`Lock button count: ${lockBtn}; Account button count: ${accountBtn}`);
console.log(`"Loading resources…" visible after 6s: ${loading}`);
console.log(`GET /api/v1/resources sent by page: ${resourcesGet}`);
console.log(`console/page error mentions "Illegal invocation": ${illegal}`);
console.log(`body text (first 400 chars): ${body}`);
const unlock200 = resps.includes("POST /auth/unlock 200");
const ok = unlock200 && url.endsWith("/vault") && lockBtn > 0 && accountBtn > 0;
console.log(`DOC CLAIM unlock->/vault with Lock+Account: ${ok ? "HOLDS" : "DOES NOT HOLD"}`);
console.log(`DOC CLAIM t_76755bb3 caveat (stuck loading, no GET resources, Illegal invocation): ${loading > 0 && resourcesGet === 0 && illegal ? "HOLDS" : "DOES NOT HOLD"}`);
process.exit(ok ? 0 : 1);
