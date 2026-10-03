// Landing page e2e: "/" renders the landing (no redirect), no horizontal scroll at 1440/1024/768/390,
// the note cards never cover the headline, the phone menu opens and closes, section links scroll, and
// /dashboard and /try still load, the logo on /dashboard and /try leads back to "/", unknown routes land on
// "/", headings are one h1 + an h2 per section, and section links clear the sticky nav.
// Saves hero, problem and how-it-works screenshots (desktop + mobile) to docs/screenshots/.
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

const SAVED = { 1440: "desktop", 390: "mobile" };

/** Screenshot of one section: scroll it to the top, size the viewport to it, hide the sticky nav meanwhile. */
async function shotSection(page, w, selector, file) {
  const [top, h] = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [Math.floor(r.top + window.scrollY), Math.ceil(r.height)]; })()`);
  await page.evaluate("document.querySelector('.landing-nav').style.visibility = 'hidden'");
  await page.setViewport(w, h + 24);
  await sleep(300);
  await page.evaluate(`window.scrollTo(0, ${top - 12})`);
  await sleep(500);
  await page.screenshot(file, { fullPage: false });
  await page.evaluate("document.querySelector('.landing-nav').style.visibility = ''; window.scrollTo(0, 0)");
  await page.setViewport(w, 900);
}

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

  const heads = await page.evaluate(`[document.querySelectorAll('h1').length, [...document.querySelectorAll('main > section')].map((sec) => sec.querySelectorAll('h2').length).join(',')]`);
  assert(heads[0] === 1 && /^0,(1,)+1$/.test(heads[1]), `one h1; an h2 in every section after the hero (${heads[1]})`);
  const svgs = await page.evaluate(`[...document.querySelectorAll('svg.scene')].every((s) => s.getAttribute('role') === 'img' && s.getAttribute('aria-labelledby'))`);
  assert(svgs, "every illustration is role=img with a title and description");

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

  // section links scroll to their sections, and the heading lands below the sticky nav
  if (w <= 900) await page.click(".landing-nav__menu");
  await page.click(`${w <= 900 ? "#landing-menu" : ".landing-nav__links"} a[href="#how-it-works"]`);
  await sleep(1200);
  const clear = await page.evaluate("[document.querySelector('#how-title').getBoundingClientRect().top, document.querySelector('.landing-nav').getBoundingClientRect().bottom]");
  assert(clear[0] >= clear[1], `"How it works" heading is below the sticky nav (${Math.round(clear[0])} >= ${Math.round(clear[1])})`);
  await page.evaluate("window.scrollTo(0, 0)");
  await sleep(300);
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
  const tag = SAVED[w];
  if (tag) await page.screenshot(toPath(new URL(`landing-hero-${tag}.png`, SHOTS)), { fullPage: false });
  if (extraDir) await page.screenshot(`${extraDir}/landing-hero-${w}.png`, { fullPage: false });
  await page.setViewport(w, 900);

  for (const [sel, name] of [["#problem", "problem"], ["#how-it-works", "how"]]) {
    if (tag) await shotSection(page, w, sel, toPath(new URL(`landing-${name}-${tag}.png`, SHOTS)));
    if (extraDir) await shotSection(page, w, sel, `${extraDir}/landing-${name}-${w}.png`);
  }

  if (w === 1440 || w === 390) {
    // the logo is the sidebar brand on desktop and the top-bar brand on phones (the sidebar is a drawer there)
    const logo = w > 900 ? '.sidebar__brand[aria-label="Bursar home"]' : '.topbar__brand[aria-label="Bursar home"]';
    await page.goto(`${APP}/dashboard`);
    await page.waitFor(`/block [0-9]+/.test(document.querySelector('[data-testid=topbar-status]')?.innerText || '')`, { timeout: 60000, label: "dashboard live" });
    assert((await page.evaluate("location.pathname")) === "/dashboard", "/dashboard loads when opened directly");
    await page.click(logo);
    await page.waitFor("!!document.querySelector('.landing-hero')", { label: "landing after logo click" });
    assert((await page.evaluate("location.pathname")) === "/", "logo on /dashboard returns to /");
    await page.goto(`${APP}/try`);
    await page.waitFor(`document.querySelector('[data-testid=topbar-status]')?.innerText.trim() === 'Not connected'`, { label: "/try idle" });
    assert((await page.evaluate("location.pathname")) === "/try", "/try loads when opened directly");
    await page.click(logo);
    await page.waitFor("!!document.querySelector('.landing-hero')", { label: "landing after logo click" });
    assert((await page.evaluate("location.pathname")) === "/", "logo on /try returns to /");
    await page.goto(`${APP}/no-such-page`);
    await page.waitFor("!!document.querySelector('.landing-hero')", { label: "landing after unknown route" });
    assert((await page.evaluate("location.pathname")) === "/", "unknown route redirects to /");
  }
  await page.close();
}
console.log("\nLanding e2e passed");
process.exit(0);
