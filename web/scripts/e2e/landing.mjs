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
  for (const [id, heading, name] of [["how-it-works", "how-title", "How it works"], ["features", "features-title", "Features"]]) {
    if (w <= 900) await page.click(".landing-nav__menu");
    await page.click(`${w <= 900 ? "#landing-menu" : ".landing-nav__links"} a[href="#${id}"]`);
    await sleep(1200);
    const clear = await page.evaluate(`[document.getElementById('${heading}').getBoundingClientRect().top, document.querySelector('.landing-nav').getBoundingClientRect().bottom, location.hash]`);
    assert(clear[0] >= clear[1] && clear[0] < 400 && clear[2] === `#${id}`, `"${name}" link scrolls its heading just below the sticky nav (${Math.round(clear[0])} >= ${Math.round(clear[1])})`);
    await page.evaluate("window.scrollTo(0, 0)");
    await sleep(300);
  }
  const ext = await page.evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('View the contracts on Arbiscan')); return a && [a.href, a.target, a.rel]; })()`);
  assert(ext && /0x822Cb3724d64870F6659ceca26534de8f5BD3840$/.test(ext[0]) && ext[1] === "_blank" && ext[2] === "noopener noreferrer", "Arbiscan link points at the demo vault, new tab, noopener noreferrer");
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

  // nothing sticks out past the viewport, and no section's content runs into the next section
  const stray = await page.evaluate(`[...document.querySelectorAll('.landing-frame *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((el) => el.className.baseVal ?? el.className).slice(0, 5)`);
  assert(stray.length === 0, `no element extends past the viewport${stray.length ? ": " + stray.join(", ") : ""}`);
  const bleed = await page.evaluate(`(() => { const secs = [...document.querySelectorAll('main > section'), document.querySelector('.landing-footer')]; const out = [];
    secs.forEach((sec, i) => { const next = secs[i + 1]; if (!next) return; const top = next.getBoundingClientRect().top;
      const deepest = Math.max(...[...sec.querySelectorAll('*')].filter((el) => !el.closest('[inert]')).map((el) => el.getBoundingClientRect().bottom));
      if (deepest > top + 0.5) out.push(sec.id || sec.className); }); return out; })()`);
  assert(bleed.length === 0, `no section overlaps the next one${bleed.length ? ": " + bleed.join(", ") : ""}`);

  if (tag) {
    await page.evaluate("window.scrollTo(0, 0)");
    await page.screenshot(toPath(new URL(`landing-full-${tag}.png`, SHOTS)), { fullPage: true, scale: 1 });
  }

  for (const [sel, name] of [["#problem", "problem"], ["#how-it-works", "how"], ["#features", "features"], ["#showcase", "showcase"], ["#faq", "faq"], [".landing-footer", "footer"]]) {
    if (tag) await shotSection(page, w, sel, toPath(new URL(`landing-${name}-${tag}.png`, SHOTS)));
    if (extraDir) await shotSection(page, w, sel, `${extraDir}/landing-${name}-${w}.png`);
  }

  if (w === 1440) {
    // ------------------------------------------------ FAQ: tabs pattern + accordion, driven by real key presses
    const tabState = () => page.evaluate(`[[...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-selected') + ':' + t.tabIndex).join(' '), document.activeElement.textContent, document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'), [...document.querySelectorAll('.landing-faq [aria-expanded]')].map((b) => b.getAttribute('aria-expanded')).join(',')]`);
    let t = await tabState();
    assert(t[0] === "true:0 false:-1 false:-1" && t[2] === "faq-tab-basics" && t[3] === "true,false,false", "FAQ starts on Basics with its first item open (roving tabindex)");
    await page.evaluate("document.querySelector('[role=tab]').focus()");
    await page.press("ArrowRight");
    t = await tabState();
    assert(t[0] === "false:-1 true:0 false:-1" && t[1] === "Safety" && t[2] === "faq-tab-safety" && t[3] === "true,false,false", "ArrowRight moves focus and selection to Safety; its first item is open");
    await page.press("End");
    t = await tabState();
    assert(t[1] === "Build" && t[2] === "faq-tab-build", "End jumps to Build");
    await page.press("ArrowRight");
    t = await tabState();
    assert(t[1] === "Basics", "ArrowRight wraps around to Basics");
    await page.press("ArrowLeft");
    t = await tabState();
    assert(t[1] === "Build", "ArrowLeft wraps back to Build");
    await page.press("Tab");
    const focusedQ = await page.evaluate("document.activeElement.getAttribute('aria-expanded') + '|' + document.activeElement.textContent");
    assert(focusedQ.startsWith("true|Which network"), "Tab from the tab list lands on the first question");
    await page.press("Enter");
    t = await tabState();
    assert(t[3] === "false,false,false", "Enter collapses the open item");
    await page.press(" ");
    t = await tabState();
    assert(t[3] === "true,false,false", "Space expands it again");
    await page.press("Tab");
    await page.press("Enter");
    t = await tabState();
    assert(t[3] === "false,true,false", "opening another item closes the first (one open at a time)");
    await sleep(400);
    const answer = await page.evaluate(`(() => { const b = document.querySelector('.landing-faq [aria-expanded=true]'); const a = document.getElementById(b.getAttribute('aria-controls'));
      const closed = document.getElementById(document.querySelector('.landing-faq [aria-expanded=false]').getAttribute('aria-controls'));
      return [a.getAttribute('role'), a.getAttribute('aria-labelledby') === b.id, a.offsetHeight > 20, closed.inert, closed.offsetHeight]; })()`);
    assert(answer[0] === "region" && answer[1] && answer[2] && answer[3] === true && answer[4] === 0, "answers are labelled regions; closed answers are collapsed and inert");

    // ------------------------------------------------ footer links
    const ext = await page.evaluate(`[...document.querySelectorAll('.landing-footer a[target=_blank]')].map((a) => a.href + ' ' + a.rel)`);
    const want = ["https://github.com/Im-2/bursar", "https://sepolia.arbiscan.io/address/0x822Cb3724d64870F6659ceca26534de8f5BD3840", "https://github.com/Im-2/bursar#readme", "https://x.com/Nuelcrypt", "https://github.com/Im-2"];
    assert(ext.length === want.length && want.every((u, i) => ext[i] === `${u} noopener noreferrer`), "footer external links are correct and open in a new tab with noopener noreferrer");
    const internal = await page.evaluate(`[...document.querySelectorAll('.landing-footer a:not([target])')].map((a) => a.getAttribute('href')).join(' ')`);
    assert(internal === "/ /dashboard /try #how-it-works #features", `footer internal links (${internal})`);

    // ------------------------------------------------ keyboard: every visible control is reachable and shows a focus ring
    await page.evaluate("window.scrollTo(0, 0); document.activeElement.blur()");
    const expected = await page.evaluate(`(() => { const els = [...document.querySelectorAll('a[href], button')].filter((el) => el.getClientRects().length && !el.closest('[inert]') && !el.closest('[hidden]') && el.tabIndex >= 0);
      els.forEach((el, i) => (el.dataset.kb = i)); return els.length; })()`);
    const seen = new Set();
    const noRing = [];
    for (let i = 0; i < expected + 5; i++) {
      await page.press("Tab");
      const f = await page.evaluate(`(() => { const el = document.activeElement; const cs = getComputedStyle(el); return [el.dataset?.kb ?? null, cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, el.textContent.trim().slice(0, 30)]; })()`);
      if (f[0] === null) continue;
      seen.add(f[0]);
      if (!f[1]) noRing.push(f[2]);
    }
    assert(seen.size === expected, `all ${expected} visible links and buttons are reachable with Tab (${seen.size})`);
    assert(noRing.length === 0, `every focused control shows a visible focus ring${noRing.length ? ": missing on " + noRing.join(", ") : ""}`);
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
    assert(page.consoleIssues.length === 0, `no console errors or warnings on /, /dashboard, /try${page.consoleIssues.length ? ":\n    " + page.consoleIssues.join("\n    ") : ""}`);
  }
  await page.close();
}
console.log("\nLanding e2e passed");
process.exit(0);
