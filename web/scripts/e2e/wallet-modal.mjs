// Wallet modal e2e: two EIP-6963 wallets listed, rejection message, connect + switch + balance + disconnect.
// Usage (dev server running): BURSAR_TEST_WALLET_FILE=/path/wallet.json node scripts/e2e/wallet-modal.mjs
import { mkdirSync } from "node:fs";
import { launch, loadTestAccount, sleep, TEST_WALLETS } from "./harness.mjs";

const APP = process.env.APP_URL || "http://localhost:5173";
const SHOTS = new URL("../../../docs/screenshots/", import.meta.url);
mkdirSync(SHOTS, { recursive: true });
const shot = (name) => new URL(name, SHOTS).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const log = (...a) => console.log(...a);
const assert = (cond, msg) => { if (!cond) throw new Error(`assertion failed: ${msg}`); log(`  ✓ ${msg}`); };

const page = await launch({ account: loadTestAccount(), startChainId: 1, wallets: 2 });
await page.goto(`${APP}/dashboard`);
await page.waitFor(`!!document.querySelector('[data-testid="connect-wallet"]')`);

log("▶ Modal lists every announced wallet");
await page.click('[data-testid="connect-wallet"]');
await page.waitFor(`document.querySelectorAll('[data-testid=wallet-list] .wallet-option').length >= 2`, { label: "two wallets" });
const names = await page.evaluate(`[...document.querySelectorAll('[data-testid=wallet-list] .wallet-option')].map(b => b.querySelector('.wallet-option__name').textContent)`);
const icons = await page.evaluate(`[...document.querySelectorAll('[data-testid=wallet-list] .wallet-option img')].length`);
assert(names.length === 2 && names.includes(TEST_WALLETS[0].name) && names.includes(TEST_WALLETS[1].name), `both EIP-6963 wallets listed: ${names.join(", ")}`);
assert(icons === 2, "each wallet shows its own icon");
assert(await page.evaluate(`!!document.querySelector('[data-testid=wallet-option-walletconnect]')`), "WalletConnect option shown (project id configured)");
assert(await page.evaluate(`!!document.querySelector('[data-testid=wallet-option-coinbaseWalletSDK]')`), "Coinbase Wallet option shown");
assert(await page.evaluate(`!document.querySelector('[data-testid=install-wallet]')`), "no install prompt when wallets are detected");
await page.screenshot(shot("wallet-modal-desktop.png"), { fullPage: false });
await page.setViewport(390, 844);
await sleep(500);
await page.screenshot(shot("wallet-modal-phone.png"), { fullPage: false });
await page.setViewport(1440, 1000);

log("▶ Rejected connection shows a clear message");
page.wallet.rejectNext = true;
await page.click(`[data-testid="wallet-option-${TEST_WALLETS[1].rdns}"]`);
await page.waitFor(`!!document.querySelector('[data-testid=wallet-error]')`, { label: "rejection message" });
const msg = await page.evaluate(`document.querySelector('[data-testid=wallet-error]').textContent`);
assert(/rejected/i.test(msg), `rejection message: "${msg}"`);
await page.screenshot(shot("wallet-modal-rejected.png"), { fullPage: false });

log("▶ Connect, auto-switch from chain 1 to Arbitrum Sepolia, show balance, disconnect");
await page.click(`[data-testid="wallet-option-${TEST_WALLETS[0].rdns}"]`);
await page.waitFor(`!!document.querySelector('[data-testid=wallet-account]')`, { label: "connected" });
assert(page.wallet.chainId === 421614, "wallet switched to chain 421614");
await page.waitFor(`!!document.querySelector('[data-testid=wallet-balance]')`, { label: "ETH balance" });
const header = await page.evaluate(`document.querySelector('[data-testid=wallet-account]').textContent`);
assert(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/.test(header) && /ETH/.test(header), `header shows short address + balance: "${header.replace(/\s+/g, " ")}"`);
assert(await page.evaluate(`!document.querySelector('[data-testid=wallet-modal]')`), "modal closed after connecting");
await page.screenshot(shot("wallet-connected-header.png"), { fullPage: false });

log("▶ Reload: the last-used connector reconnects without a click");
await page.goto(`${APP}/dashboard`);
await page.waitFor(`!!document.querySelector('[data-testid=wallet-account]')`, { label: "auto-reconnect", timeout: 20000 });
assert(true, "reconnected after reload (last connector persisted)");
await page.click('[data-testid="disconnect"]');
await page.waitFor(`!!document.querySelector('[data-testid="connect-wallet"]')`, { label: "disconnected" });
assert(true, "disconnect returns to the connect button");

await page.close();
log("\nWallet modal e2e passed");
process.exit(0);
