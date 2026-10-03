// Brand e2e: the Bursar mark (public/bursar-mark.svg) renders wherever the logo appears (landing nav, footer,
// dashboard sidebar, /try top bar on phones) with alt "Bursar", favicon + title + og tags are set, and a
// size sheet at 24/40/64px is captured. Screenshots go to docs/screenshots/ (nav) and an optional extra dir.
// Usage (dev server running): BURSAR_TEST_WALLET_FILE=/path/wallet.json node scripts/e2e/brand.mjs [extraShotDir]
import { launch, loadTestAccount, sleep } from "./harness.mjs";

const APP = process.env.APP_URL || "http://localhost:5173";
const SHOTS = new URL("../../../docs/screenshots/", import.meta.url);
const toPath = (u) => u.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const extraDir = process.argv[2];
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
/** Every visible mark matching `scope`: [loaded, alt, rendered width]. */
const marks = (page, scope) =>
  page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} img.brand__mark`)})].filter((i) => i.getClientRects().length)
    .map((i) => [i.complete && i.naturalWidth > 0, i.alt, Math.round(i.getBoundingClientRect().width), new URL(i.src).pathname])`);
const ok = (list, size) => list.length > 0 && list.every(([loaded, alt, w, src]) => loaded && alt === "Bursar" && w === size && src === "/bursar-mark.svg");

// ---------------------------------------------------------------- desktop
console.log("▶ 1440px");
let page = await launch({ account: loadTestAccount(), width: 1440, height: 900 });
await page.goto(`${APP}/`);
await page.waitFor("!!document.querySelector('.landing-hero')");
await sleep(600);
const head = await page.evaluate(`[document.title, document.querySelector('link[rel=icon]')?.getAttribute('href'), document.querySelector('link[rel=icon]')?.type,
  ...['og:title', 'og:description', 'og:image'].map((p) => document.querySelector('meta[property="' + p + '"]')?.content ?? null)]`);
assert(head[0] === "Bursar - spending limits for AI agents", `title is "${head[0]}"`);
assert(head[1] === "/bursar-mark.svg" && head[2] === "image/svg+xml", "favicon is /bursar-mark.svg (image/svg+xml)");
assert(head[3] === "Bursar - spending limits for AI agents" && !!head[4] && head[5] === "https://trybursar.vercel.app/bursar-mark.png", "og:title, og:description and og:image (absolute URL) are set");
const icon = await page.evaluate("fetch('/bursar-mark.svg').then((r) => r.status + ' ' + r.headers.get('content-type'))");
const png = await page.evaluate("fetch('/bursar-mark.png').then((r) => r.status + ' ' + r.headers.get('content-type'))");
assert(icon.startsWith("200 image/svg+xml") && png.startsWith("200 image/png"), `both files are served (${icon}; ${png})`);
assert(ok(await marks(page, ".landing-nav"), 40), "landing nav: mark loaded, alt Bursar, 40px");
assert(ok(await marks(page, ".landing-footer"), 40), "landing footer: mark loaded, alt Bursar, 40px");
const wordmark = await page.evaluate("document.querySelector('.landing-nav .brand').textContent.trim()");
assert(wordmark === "Bursar", "wordmark text still next to the mark");
await page.setViewport(1440, 110);
await sleep(300);
await page.screenshot(toPath(new URL("brand-nav-desktop.png", SHOTS)), { fullPage: false });

// size sheet: 24 / 40 / 64 on the cream canvas and on white
await page.setViewport(520, 220);
await page.evaluate(`(() => {
  const d = document.createElement('div');
  d.id = 'size-sheet';
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;grid-template-columns:1fr 1fr;font:600 12px var(--font-mono)';
  for (const bg of ['var(--c-canvas)', '#ffffff']) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;align-items:end;justify-content:center;gap:22px;padding:28px 12px;background:' + bg;
    for (const s of [24, 40, 64]) col.insertAdjacentHTML('beforeend', '<figure style="margin:0;display:grid;justify-items:center;gap:8px"><img src="/bursar-mark.svg" alt="Bursar" width="' + s + '" height="' + s + '"><figcaption>' + s + 'px</figcaption></figure>');
    d.append(col);
  }
  document.body.append(d);
})()`);
await sleep(500);
if (extraDir) {
  await page.screenshot(`${extraDir}/brand-sizes.png`, { fullPage: false, scale: 2 });
}
await page.evaluate("document.getElementById('size-sheet').remove()");

await page.setViewport(1440, 900);
await page.goto(`${APP}/dashboard`);
await page.waitFor(`/block [0-9]+/.test(document.querySelector('[data-testid=topbar-status]')?.innerText || '')`, { timeout: 60000 });
assert(ok(await marks(page, ".sidebar"), 40), "dashboard sidebar: mark loaded, alt Bursar, 40px");
if (extraDir) {
  await page.setViewport(1440, 300);
  await sleep(300);
  await page.screenshot(`${extraDir}/brand-sidebar.png`, { fullPage: false });
}
await page.close();

// ---------------------------------------------------------------- phone
console.log("▶ 390px");
page = await launch({ account: loadTestAccount(), width: 390, height: 844 });
await page.goto(`${APP}/`);
await page.waitFor("!!document.querySelector('.landing-hero')");
await sleep(600);
assert(ok(await marks(page, ".landing-nav"), 40), "landing nav (phone): mark loaded, 40px");
await page.setViewport(390, 90);
await sleep(300);
await page.screenshot(toPath(new URL("brand-nav-mobile.png", SHOTS)), { fullPage: false });
await page.setViewport(390, 844);
await page.goto(`${APP}/try`);
await page.waitFor(`document.querySelector('[data-testid=topbar-status]')?.innerText.trim() === 'Not connected'`);
assert(ok(await marks(page, ".topbar"), 36), "/try top bar (phone): mark loaded, alt Bursar, 36px");
await page.click(".topbar__brand");
await page.waitFor("!!document.querySelector('.landing-hero')");
assert((await page.evaluate("location.pathname")) === "/", "the /try top-bar mark links home");
if (extraDir) {
  await page.goto(`${APP}/try`);
  await page.waitFor(`document.querySelector('[data-testid=topbar-status]')?.innerText.trim() === 'Not connected'`);
  await page.setViewport(390, 120);
  await sleep(300);
  await page.screenshot(`${extraDir}/brand-try-topbar.png`, { fullPage: false });
}
assert(page.consoleIssues.length === 0, `no console errors or warnings${page.consoleIssues.length ? ": " + page.consoleIssues.join("; ") : ""}`);
await page.close();
console.log("\nBrand e2e passed");
process.exit(0);
