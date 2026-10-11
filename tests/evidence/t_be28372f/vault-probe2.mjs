// QA probe 2 for t_be28372f: timeline of the Vault page after unlock + receiver check of window.fetch.
// The init script wraps window.fetch but forwards the ORIGINAL receiver (orig.apply(this, args)),
// so a non-window receiver still throws exactly as without the wrapper.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { chromium } = require("@playwright/test");

const WEB_URL = "http://localhost:5173";
const stamp = Date.now();
const email = `qa.docs2+${stamp}@example.test`;
const mp = "synthetic-docs-check-battery-staple";
const reg = await fetch(`${WEB_URL}/auth/register`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, username: `qadocs2${stamp}`, masterPassword: mp }),
});
console.log(`register via :5173 -> HTTP ${reg.status}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  const orig = window.fetch;
  window.__fetchLog = [];
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url;
    const entry = { url: String(url), receiverIsWindow: this === window || this === undefined };
    try {
      const p = orig.apply(this, [input, init]);
      const rec = { ...entry, threw: null, rejected: null };
      window.__fetchLog.push(rec);
      p.then(null, (e) => { rec.rejected = String(e); });
      return p;
    } catch (e) {
      window.__fetchLog.push({ ...entry, threw: String(e) });
      throw e;
    }
  };
});
await page.goto(`${WEB_URL}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Master password").fill(mp);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/vault", { timeout: 10_000 });
const t0 = Date.now();
let last = "";
for (let i = 0; i <= 20; i++) {
  const loading = await page.getByText("Loading resources…").count();
  const failed = await page.getByText("Failed to load resources.").count();
  const state = loading ? "Loading resources…" : failed ? "Failed to load resources. (Retry)" : "other";
  if (state !== last) { console.log(`t+${((Date.now() - t0) / 1000).toFixed(1)}s: ${state}`); last = state; }
  await page.waitForTimeout(1000);
}
console.log(`final state after ~20s: ${last}`);
const log = await page.evaluate(() => window.__fetchLog);
const tokenFree = log.map((e) => ({ url: e.url.replace(/[?#].*$/, ""), receiverIsWindow: e.receiverIsWindow, threw: e.threw, rejected: e.rejected }));
console.log(`window.fetch calls: ${JSON.stringify(tokenFree)}`);
await page.screenshot({ path: new URL("./vault-20s-after-unlock.png", import.meta.url).pathname });
await browser.close();
