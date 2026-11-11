#!/usr/bin/env node
/**
 * End-to-end browser test against a RUNNING server (next start / server.js).
 *
 *   BASE_URL=http://localhost:3000 SMOKE_MODE=full NEWBIE_EMAIL=... NEWBIE_PASSWORD=... node scripts/smoke-test.mjs
 *
 * SMOKE_MODE=full         : DB configured, demo seed loaded with users
 *                           (npm run db:seed-demo). Optionally NEWBIE_EMAIL /
 *                           NEWBIE_PASSWORD for a user created via
 *                           `admin create-user` (tests forced password change).
 * SMOKE_MODE=unconfigured : server started WITHOUT DB_* variables.
 *
 * Requires the `playwright` package. NEVER point this at production: it signs
 * in with demo accounts and triggers login throttling for a throwaway email.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MODE = process.env.SMOKE_MODE ?? "full";
const SHOTS = process.env.SCREENSHOT_DIR;
const DEMO_PASSWORD = "UrayDemo2026!";

let failures = 0;
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    results.push(`  ✗ ${name}\n      ${err.message.split("\n")[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await chromium.launch();

async function newPage(viewport = { width: 1366, height: 860 }) {
  const context = await browser.newContext({ viewport, locale: "id-ID" });
  return context.newPage();
}

async function login(page, email, password, next) {
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Email").waitFor({ timeout: 10000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
}

async function navHrefs(page) {
  const nav = page.getByRole("navigation", { name: "Navigasi utama" }).first();
  await nav.waitFor({ timeout: 15000 });
  return nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
}

const page = await newPage();

await check("health endpoint reports database state", async () => {
  const res = await page.request.get(`${BASE}/api/health`);
  const body = await res.json();
  if (MODE === "full")
    assert(res.status() === 200 && body.status === "ok", `got ${res.status()} ${JSON.stringify(body)}`);
  else assert(res.status() === 503 && body.checks.databaseConfigured === false, `got ${res.status()}`);
});

await check("security headers are set", async () => {
  const h = (await page.request.get(`${BASE}/login`)).headers();
  assert(h["x-frame-options"] === "DENY", "X-Frame-Options missing");
  assert(h["x-content-type-options"] === "nosniff", "nosniff missing");
  assert(h["referrer-policy"], "Referrer-Policy missing");
  assert(!h["x-powered-by"], "X-Powered-By should be disabled");
});

for (const path of ["/", "/dashboard", "/settings/members", "/account/password"]) {
  await check(`unauthenticated ${path} redirects to /login`, async () => {
    await page.goto(`${BASE}${path}`);
    const url = new URL(page.url());
    assert(url.pathname === "/login", `landed on ${url.pathname}`);
    if (path !== "/") assert(url.searchParams.get("next") === path, `next=${url.searchParams.get("next")}`);
  });
}

await check("forged session cookie is rejected server-side and leaks no data", async () => {
  const p = await newPage();
  await p.context().addCookies([{ name: "uci_session", value: "x".repeat(43), url: BASE }]);
  // The proxy only checks cookie presence; the server-side session lookup then
  // redirects from inside the streamed response.
  await p.goto(`${BASE}/dashboard`);
  await p.waitForURL("**/login", { timeout: 10000 });
  const html = await (await p.context().request.get(`${BASE}/master-data/products`)).text();
  assert(!/MU-HUTAN|Kesiapan master data|owner\.demo/.test(html), "protected content present in raw HTML");
  await p.context().close();
});

if (MODE === "unconfigured") {
  await check("login page explains missing database configuration", async () => {
    await page.goto(`${BASE}/login`);
    await page.getByText("Database belum dikonfigurasi").first().waitFor({ timeout: 10000 });
  });
}

if (MODE === "full") {
  await check("invalid email shows a field-level validation error", async () => {
    await login(page, "bukan-email", "whatever");
    await page.getByText("Masukkan alamat email yang valid.").waitFor({ timeout: 10000 });
    assert((await page.getByLabel("Email").getAttribute("aria-invalid")) === "true", "aria-invalid not set");
  });

  await check("wrong password shows a generic error", async () => {
    await login(page, "viewer.demo@uray.local", "SalahPassword1");
    await page.getByText("Email atau password salah, atau akun tidak aktif.").waitFor({ timeout: 10000 });
  });

  await check("repeated failures trigger temporary lockout", async () => {
    const email = `bruteforce-${Date.now()}@uray.local`;
    for (let i = 0; i < 5; i++) {
      await login(page, email, `Salah${i}Password`);
      await page.getByText("Email atau password salah").waitFor({ timeout: 10000 });
    }
    await login(page, email, "Salah9Password");
    await page.getByText("Terlalu banyak percobaan gagal").waitFor({ timeout: 10000 });
  });

  await check("open redirect in ?next is neutralised", async () => {
    await page.goto(`${BASE}/login?next=//evil.example.com/phish`);
    await page.getByLabel("Email").waitFor({ timeout: 10000 });
    const value = await page.locator('input[name="next"]').getAttribute("value");
    assert(value === "/dashboard", `hidden next = ${value}`);
  });

  await check("viewer: DEMO dashboard, restricted navigation, COGS hidden, 403 on admin pages", async () => {
    const p = await newPage();
    await login(p, "viewer.demo@uray.local", DEMO_PASSWORD);
    await p.waitForURL("**/dashboard", { timeout: 15000 });
    await p.getByText("Organisasi DEMO").waitFor({ timeout: 10000 });
    const hrefs = await navHrefs(p);
    assert(hrefs.includes("/master-data/products"), "viewer should see Master Produk");
    assert(!hrefs.includes("/imports"), "viewer must not see Impor Data");
    assert(!hrefs.includes("/settings/members"), "viewer must not see settings");
    // Master data readiness from the DB: 6 products, 9 SKUs, 10 listings, 2 unmapped
    const kpi = (await p.locator("main").innerText()).replace(/\s+/g, " ");
    for (const expected of ["Produk 6", "Varian SKU 9", "Channel listing 10", "Listing belum dipetakan 2"]) {
      assert(kpi.includes(expected), `dashboard missing "${expected}"`);
    }
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/dashboard-viewer.png`, fullPage: true });

    await p.goto(`${BASE}/master-data/products`);
    await p.getByText("MU-HUTAN-500").waitFor({ timeout: 10000 });
    assert((await p.getByText("Terbatas").count()) > 0, "COGS should be masked for viewer");
    assert((await p.getByText("68.000").count()) === 0, "COGS value leaked to viewer");

    await p.goto(`${BASE}/settings/members`);
    await p.waitForURL("**/forbidden", { timeout: 10000 });

    await p.goto(`${BASE}/dashboard`);
    await p.getByRole("button", { name: "Menu pengguna" }).click();
    await p.getByRole("menuitem", { name: "Keluar" }).click();
    await p.waitForURL("**/login", { timeout: 10000 });
    await p.goto(`${BASE}/dashboard`);
    assert(new URL(p.url()).pathname === "/login", "session should be gone after logout");
    await p.context().close();
  });

  await check("analyst: sees Impor Data and COGS, still blocked from settings", async () => {
    const p = await newPage();
    await login(p, "analyst.demo@uray.local", DEMO_PASSWORD, "/master-data/products");
    await p.waitForURL("**/master-data/products", { timeout: 15000 });
    await p.getByText("68.000").first().waitFor({ timeout: 10000 });
    const hrefs = await navHrefs(p);
    assert(hrefs.includes("/imports"), "analyst should see Impor Data");
    assert(!hrefs.includes("/settings/audit-log"), "analyst must not see Audit Log");
    await p.goto(`${BASE}/settings/audit-log`);
    await p.waitForURL("**/forbidden", { timeout: 10000 });
    await p.context().close();
  });

  await check("admin: members list and audit trail of logins", async () => {
    const p = await newPage();
    await login(p, "admin.demo@uray.local", DEMO_PASSWORD);
    await p.waitForURL("**/dashboard", { timeout: 15000 });
    await p.goto(`${BASE}/settings/members`);
    await p.getByText("owner.demo@uray.local").waitFor({ timeout: 10000 });
    await p.goto(`${BASE}/settings/audit-log`);
    await p.getByText("Login gagal").first().waitFor({ timeout: 10000 });
    assert((await p.getByText("Login", { exact: true }).count()) > 0, "successful logins should be audited");
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/audit-admin.png`, fullPage: true });
    await p.context().close();
  });

  await check("listings page shows unmapped listings", async () => {
    const p = await newPage();
    await login(p, "owner.demo@uray.local", DEMO_PASSWORD, "/master-data/listings");
    await p.waitForURL("**/master-data/listings", { timeout: 15000 });
    await p.getByText("2 belum dipetakan").waitFor({ timeout: 10000 });
    await p.goto(`${BASE}/settings/organization`);
    await p.getByText("madu-uray-demo").waitFor({ timeout: 10000 });
    await p.context().close();
  });

  if (process.env.NEWBIE_EMAIL && process.env.NEWBIE_PASSWORD) {
    await check("new user must change temporary password before using the app", async () => {
      const p = await newPage();
      await login(p, process.env.NEWBIE_EMAIL, process.env.NEWBIE_PASSWORD);
      await p.waitForURL("**/account/password", { timeout: 15000 });
      await p.goto(`${BASE}/dashboard`);
      await p.waitForURL("**/account/password", { timeout: 10000 });

      await p.getByLabel("Password saat ini").fill(process.env.NEWBIE_PASSWORD);
      await p.getByLabel("Password baru", { exact: true }).fill("lemah");
      await p.getByLabel("Ulangi password baru").fill("lemah");
      await p.getByRole("button", { name: "Simpan password" }).click();
      await p.getByText("Password minimal 10 karakter.").waitFor({ timeout: 10000 });

      await p.getByLabel("Password saat ini").fill(process.env.NEWBIE_PASSWORD);
      await p.getByLabel("Password baru", { exact: true }).fill("MaduBaru2026x");
      await p.getByLabel("Ulangi password baru").fill("MaduBaru2026x");
      await p.getByRole("button", { name: "Simpan password" }).click();
      await p.waitForURL("**/dashboard", { timeout: 15000 });
      await p.context().close();
    });
  }

  await check("mobile: authenticated dashboard has no horizontal overflow", async () => {
    const p = await newPage({ width: 375, height: 800 });
    await login(p, "owner.demo@uray.local", DEMO_PASSWORD);
    await p.waitForURL("**/dashboard", { timeout: 15000 });
    await p.getByText("Kesiapan master data").waitFor({ timeout: 10000 });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!overflow, "horizontal overflow detected");
    await p.getByRole("button", { name: "Buka navigasi" }).click();
    await p.getByRole("dialog").getByText("Audit Log").waitFor({ timeout: 5000 });
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/dashboard-mobile-nav.png` });
    await p.context().close();
  });
}

await check("mobile: login page has no horizontal overflow", async () => {
  const p = await newPage({ width: 375, height: 740 });
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Email").waitFor({ timeout: 10000 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, "horizontal overflow detected");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/login-mobile-${MODE}.png`, fullPage: true });
  await p.context().close();
});

await browser.close();

console.log(`E2E (${MODE}) against ${BASE}`);
console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
