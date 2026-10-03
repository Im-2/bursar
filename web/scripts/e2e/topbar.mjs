// Top-bar status e2e: /try shows "Not connected" before a wallet connects (never a stuck "Loading…"),
// "Connected" + address after, and /dashboard keeps "Live · Updated Ns ago · block N". Desktop and phone.
// Usage (dev server running): BURSAR_TEST_WALLET_FILE=/path/wallet.json node scripts/e2e/topbar.mjs
import { launch, loadTestAccount, sleep } from "./harness.mjs";

const APP = process.env.APP_URL || "http://localhost:5173";
const SHOTS = new URL("../../../docs/screenshots/", import.meta.url);
const shot = (name) => new URL(name, SHOTS).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
const status = (page) =>
  page.evaluate(`document.querySelector('[data-testid=topbar-status]').innerText.replace(/\\s+/g, ' ').trim()`);

for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]]) {
  console.log(`▶ ${tag} (${w}px)`);
  const page = await launch({ account: loadTestAccount(), startChainId: 1, width: w, height: h });
  await page.goto(`${APP}/try`);
  await sleep(6000); // long enough that a stuck "Loading…" would still be showing
  const idle = await status(page);
  assert(idle === "Not connected", `/try before connecting shows "${idle}"`);
  await page.screenshot(shot(`try-topbar-disconnected-${tag}.png`), { fullPage: false });

  await page.connect();
  await sleep(2500);
  const connected = await status(page);
  const chip = await page.evaluate(`document.querySelector('[data-testid=wallet-account]')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert(connected === "Connected" && /0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/.test(chip), `/try after connecting shows "${connected}" + wallet "${chip.trim()}"`);
  await page.screenshot(shot(`try-topbar-connected-${tag}.png`), { fullPage: false });

  await page.goto(`${APP}/dashboard`);
  await page.waitFor(`/block [0-9]+/.test(document.querySelector('[data-testid=topbar-status]')?.innerText || '')`, { timeout: 60000 });
  const live = await status(page);
  assert(/^(Live|Paused) Updated .* block [0-9]+$/.test(live), `/dashboard shows "${live}"`);
  await page.close();
}
console.log("\nTop bar e2e passed");
process.exit(0);
