// Landing page e2e: "/" renders the landing (no redirect), no horizontal scroll at 1440/1024/768/390,
// the note cards never cover the headline, the phone menu opens and closes, section links scroll, and
// /dashboard and /try still load. Saves hero screenshots (desktop + mobile) to docs/screenshots/.
// Usage (dev server running): BURSAR_TEST_WALLET_FILE=/path/wallet.json node scripts/e2e/landing.mjs [extraShotDir]
import { launch, loadTestAccount, sleep } from "./harness.mjs";

const APP = process.env.APP_URL || "http://localhost:5173";
const SHOTS = new URL("../../../docs/screenshots/", import.meta.url);
const toPath = (u) => u.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const extraDir = process.argv[2];
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

const SAVED = { 1440: "landing-hero-desktop.png", 390: "landing-hero-mobile.png" };

for (const w of [1440, 1024, 768, 390]) {
  console.log(`▶ ${w}px`);
  const page = await launch({ account: loadTestAccount(), width: w, height: 900 });
  await page.goto(`${APP}/`);
  await page.waitFor(`!!document.querySelector('.landing-hero .scene')`, { label: "hero scene" });
  await sleep(500);
  assert((await page.evaluate("location.pathname")) === "/", `"/" stays on the landing page`);
  const scroll = await page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]");
  assert(scroll[0] <= scroll[1], `no horizontal scroll (${scroll[0]} <= ${scroll[1]})`);
  const overlap = await page.evaluate(`(() => {
    const h = document.querySelector('.landing-hero__text').getBoundingClientRect();
    return [...document.querySelectorAll('.landing-note')].some((n) => {
      const r = n.getBoundingClientRect();
      return r.left < h.right && r.right > h.left && r.top < h.bottom && r.bottom > h.top;
    });
  })()`);
  assert(!overlap, "note cards do not overlap the headline block");
  const svg = await page.evaluate(`(() => { const s = document.querySelector('.scene'); return s.getAttribute('role') + '|' + document.getElementById(s.getAttribute('aria-labelledby').split(' ')[0]).textContent; })()`);
  assert(svg.startsWith("img|"), `scene is role="img" with a title ("${svg.split("|")[1]}")`);

  if (w <= 768) {
    const hidden = await page.evaluate(`getComputedStyle(document.querySelector('.landing-nav__links')).display`);
    assert(hidden === "none", "nav links collapse into the menu");
    await page.click(".landing-nav__menu");
    await sleep(300);
    const shown = await page.evaluate(`[document.querySelector('.landing-nav__menu').getAttribute('aria-expanded'), getComputedStyle(document.querySelector('#landing-menu')).display]`);
    assert(shown[0] === "true" && shown[1] === "grid", "menu button opens the panel");
    if (extraDir) await page.screenshot(`${extraDir}/landing-menu-${w}.png`, { fullPage: false });
    await page.click(".landing-nav__menu");
    await sleep(200);
  }

  // section links scroll to their placeholder sections
  if (w <= 900) await page.click(".landing-nav__menu");
  await page.click(`${w <= 900 ? "#landing-menu" : ".landing-nav__links"} a[href="#faq"]`);
  await sleep(1200);
  const faq = await page.evaluate("[window.scrollY, location.hash, document.querySelector('#landing-menu').hidden]");
  assert(faq[0] > 0 && faq[1] === "#faq" && faq[2] === true, `FAQ link scrolls to #faq (scrollY ${faq[0]}) and closes the menu`);
  await page.evaluate("window.scrollTo(0, 0)");
  await sleep(300);

  // hero-only screenshot: viewport tall enough to include the whole hero section
  const heroBottom = await page.evaluate("Math.ceil(document.querySelector('.landing-hero').getBoundingClientRect().bottom + window.scrollY)");
  await page.setViewport(w, heroBottom + 24);
  await sleep(400);
  const name = SAVED[w];
  if (name) await page.screenshot(toPath(new URL(name, SHOTS)), { fullPage: false });
  if (extraDir) await page.screenshot(`${extraDir}/landing-hero-${w}.png`, { fullPage: false });
  await page.setViewport(w, 900);

  if (w === 1440 || w === 390) {
    await page.goto(`${APP}/dashboard`);
    await page.waitFor(`/block [0-9]+/.test(document.querySelector('[data-testid=topbar-status]')?.innerText || '')`, { timeout: 60000, label: "dashboard live" });
    assert((await page.evaluate("location.pathname")) === "/dashboard", "/dashboard loads");
    await page.goto(`${APP}/try`);
    await page.waitFor(`document.querySelector('[data-testid=topbar-status]')?.innerText.trim() === 'Not connected'`, { label: "/try idle" });
    assert((await page.evaluate("location.pathname")) === "/try", "/try loads");
  }
  await page.close();
}
console.log("\nLanding e2e passed");
process.exit(0);
