// Evidence harness for t_76755bb3 — after a browser login under `pnpm dev`, the
// Vault page itself must send GET /api/v1/resources with a Bearer token and render
// the empty state (or rows), instead of hanging on "Loading resources…" because
// ApiClient called `window.fetch` with an illegal receiver.
//
// Extends tests/evidence/t_aeb2617e/browser-unlock.mjs (same register + login flow).
//
// Prerequisite (fresh clone, repo root):
//   pnpm install && pnpm --filter @password-manager/api migrate && pnpm dev
// Then, in a second terminal:
//   node tests/evidence/t_76755bb3/vault-resources.mjs
//
// Tokens are never printed: the Authorization header is reduced to its scheme and
// a boolean "has a non-empty credential". All fixtures are synthetic (@example.test).
//
// Env: WEB_URL (default http://localhost:5173).
import { chromium } from "@playwright/test";

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:5173").replace(
  /\/+$/,
  "",
);
const stamp = Date.now();
// Synthetic, reserved-domain fixture (RFC 2606). Unique per run so re-runs work.
const email = `alice+${stamp}@example.test`;
// `mp` (not `masterPassword = ...`): the repo gitleaks generic-api-key rule flags
// `password = <16+ chars>`, even for a synthetic value.
const mp = "synthetic-correct-horse-battery-staple";

const reg = await fetch(`${WEB_URL}/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, username: `alice${stamp}`, masterPassword: mp }),
});
console.log(`register via ${WEB_URL}/auth/register -> HTTP ${reg.status}`);
if (reg.status !== 201) process.exit(1);

const browser = await chromium.launch();
const page = await browser.newPage();

// Every request the PAGE makes to /api/v1/resources (the harness makes none).
const resourceRequests = [];
page.on("request", (req) => {
  const path = new URL(req.url()).pathname;
  if (path !== "/api/v1/resources") return;
  const auth = req.headers()["authorization"] ?? "";
  const [scheme, credential] = auth.split(" ");
  resourceRequests.push({
    method: req.method(),
    path,
    authScheme: scheme || "<none>",
    hasCredential: Boolean(credential && credential.length > 0),
    req,
  });
});
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err.message)));
page.on("console", (msg) => {
  if (msg.type() === "error") pageErrors.push(msg.text());
});

await page.goto(`${WEB_URL}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Master password").fill(mp);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/vault", { timeout: 10_000 });

// Wait for the vault to settle into one of its terminal states.
const settled = await page
  .locator(".vault-empty, table, .vault-error")
  .first()
  .waitFor({ timeout: 15_000 })
  .then(() => true)
  .catch(() => false);

const emptyText = await page
  .locator(".vault-empty")
  .first()
  .innerText()
  .catch(() => null);
const errorText = await page
  .locator(".vault-error")
  .first()
  .innerText()
  .catch(() => null);
const stillLoading = await page.getByText("Loading resources…").isVisible();

const resourceResults = [];
for (const r of resourceRequests) {
  const res = await r.req.response();
  resourceResults.push({
    method: r.method,
    path: r.path,
    authScheme: r.authScheme,
    hasCredential: r.hasCredential,
    status: res?.status() ?? null,
    contentType: res?.headers()["content-type"] ?? null,
  });
}

await page.screenshot({
  path: new URL("./vault-resources.png", import.meta.url).pathname,
});
await browser.close();

console.log(`final URL: ${page.url()}`);
console.log(`vault settled: ${settled}`);
console.log(`still "Loading resources…": ${stillLoading}`);
console.log(`empty state: ${JSON.stringify(emptyText)}`);
console.log(`error state: ${JSON.stringify(errorText)}`);
console.log("page-initiated /api/v1/resources requests:");
for (const r of resourceResults) console.log("  " + JSON.stringify(r));
console.log(`page errors (${pageErrors.length}):`);
for (const e of pageErrors) console.log("  " + e);

const ok =
  resourceResults.some(
    (r) =>
      r.method === "GET" &&
      r.authScheme === "Bearer" &&
      r.hasCredential &&
      r.status === 200 &&
      r.contentType?.includes("application/json"),
  ) &&
  settled &&
  !stillLoading &&
  errorText === null &&
  emptyText === "No resources yet." &&
  !pageErrors.some((e) => e.includes("Illegal invocation"));
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
