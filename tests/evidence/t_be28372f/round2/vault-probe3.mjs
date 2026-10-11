// QA probe 3 for t_be28372f round 2 (docs PR #152, cadaea2).
// Checks the reworded t_76755bb3 caveat live: "Loading resources…" for a few seconds,
// then "Failed to load resources." with a Retry button, and "Retry does not help".
// Clicks Retry twice and records the page state + window.fetch outcomes after each click.
// No token values are printed (URLs are stripped of query strings; bodies are never logged).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { chromium } = require("@playwright/test");

const WEB_URL = "http://localhost:5173";
const stamp = Date.now();
const email = `qa.docs3+${stamp}@example.test`;
const mp = "synthetic-docs-check-battery-staple";
const reg = await fetch(`${WEB_URL}/auth/register`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, username: `qadocs3${stamp}`, masterPassword: mp }),
});
console.log(`register via :5173 -> HTTP ${reg.status}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  const orig = window.fetch;
  window.__fetchLog = [];
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url;
    const rec = { url: String(url).replace(/[?#].*$/, ""), receiverIsWindow: this === window || this === undefined, threw: null, rejected: null };
    window.__fetchLog.push(rec);
    try {
      const p = orig.apply(this, [input, init]);
      p.then(null, (e) => { rec.rejected = String(e); });
      return p;
    } catch (e) { rec.threw = String(e); throw e; }
  };
});
let unlockStatus = null;
page.on("response", (r) => { if (r.url().endsWith("/auth/unlock")) unlockStatus = r.status(); });
await page.goto(`${WEB_URL}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Master password").fill(mp);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/vault", { timeout: 10_000 });
console.log(`POST /auth/unlock -> HTTP ${unlockStatus}; url now ${new URL(page.url()).pathname}`);

async function state() {
  const loading = await page.getByText("Loading resources…").count();
  const failed = await page.getByText("Failed to load resources.").count();
  const retry = await page.getByRole("button", { name: /retry/i }).count();
  const rows = await page.getByRole("listitem").count();
  return loading ? "Loading resources…" : failed ? `Failed to load resources. (retry buttons=${retry}, listitems=${rows})` : `other (listitems=${rows})`;
}
async function timeline(label, secs) {
  const t0 = Date.now(); let last = "";
  for (let i = 0; i <= secs; i++) {
    const s = await state();
    if (s !== last) { console.log(`${label} t+${((Date.now() - t0) / 1000).toFixed(1)}s: ${s}`); last = s; }
    await page.waitForTimeout(1000);
  }
  console.log(`${label} final after ~${secs}s: ${last}`);
  return last;
}
await timeline("after-unlock", 10);
for (const n of [1, 2]) {
  const before = (await page.evaluate(() => window.__fetchLog.length));
  await page.getByRole("button", { name: /retry/i }).first().click();
  const final = await timeline(`after-retry-${n}`, 10);
  const newCalls = await page.evaluate((b) => window.__fetchLog.slice(b), before);
  console.log(`after-retry-${n} new window.fetch calls: ${JSON.stringify(newCalls)}`);
  console.log(`after-retry-${n} RESULT: ${final.startsWith("Failed to load resources.") ? "still failing (Retry does not help)" : "CHANGED"}`);
}
await page.screenshot({ path: new URL("./vault-after-2-retries.png", import.meta.url).pathname });
await browser.close();
