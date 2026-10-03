// Stage C end-to-end: the /try playground, driven only through the UI with a throwaway test wallet.
// Usage (dev server running): BURSAR_TEST_WALLET_FILE=/path/wallet.json node scripts/e2e/stage-c.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import deployment from "../../../deployments/arbitrum-sepolia.json" with { type: "json" };
import { launch, loadTestAccount, sleep } from "./harness.mjs";

const APP = process.env.APP_URL || "http://localhost:5173";
const SHOTS = new URL("../../../docs/screenshots/", import.meta.url);
mkdirSync(SHOTS, { recursive: true });
const shot = (name) => new URL(name, SHOTS).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const log = (...a) => console.log(...a);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  log(`  ✓ ${msg}`);
};
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '')`;
const stepState = (n) => `document.querySelector('[data-testid=step-${n}]')?.dataset.state`;

const account = loadTestAccount();
const page = await launch({ account, startChainId: 1, log });
const tx = [];
const signed = async (label, fn, opts) => {
  const h = await page.signed(label, fn, opts);
  tx.push({ label, hashes: h });
  return h;
};

log("▶ Step 1: connect (wallet starts on chain 1)");
await page.goto(`${APP}/try`);
await page.waitFor(`/No real funds/.test(${text("[data-testid=sandbox-label]")})`);
assert(true, "sandbox label shown: Testnet sandbox. Mock token. No real funds.");
await page.connect();
assert(page.wallet.chainId === 421614, "switched to Arbitrum Sepolia");
await page.waitFor(`${stepState(1)} === 'done' && ${stepState(2)} === 'current'`, { label: "step 1 done" });

log("▶ Step 2: create my vault, mint mock USDG, approve + deposit");
await signed("createVault via factory", () => page.click('[data-testid="create-vault"]'));
await page.waitFor(`!!document.querySelector('.pg-vault-line a')`, { label: "new vault selected" });
const vault = await page.evaluate(`document.querySelector('.pg-vault-line a').getAttribute('title')`);
assert(vault && vault.toLowerCase() !== deployment.contracts.BursarVault.address.toLowerCase(), `own vault ${vault} (not the demo vault)`);
await signed("mint 1000 mUSDG", () => page.click('[data-testid="mint"]'));
await signed("approve + deposit 1000", () => page.click('[data-testid="deposit"]'), { count: 2 });
await page.waitFor(`${stepState(2)} === 'done' && ${stepState(3)} === 'current'`, { label: "step 2 done" });

log("▶ Step 3: register me as agent, allowlist the vendor, open a task");
await signed("setAgent(me) 100/500/50", () => page.click('[data-testid="save-policy"]'));
await signed("allowlist vendor", () => page.click('[data-testid="allow-vendor"]'));
await signed("openTask 500", () => page.click('[data-testid="open-task"]'));
await page.waitFor(`${stepState(3)} === 'done' && !!document.querySelector('[data-testid=scenarios]')`, { label: "step 3 done, scenarios unlocked" });
assert(await page.evaluate(`!!document.querySelector('[data-testid=my-vault-state]')`), "live state of my vault shown next to the scenarios");

log("▶ Step 4a: buy data (direct payment)");
await signed("a) pay 20 to vendor", () => page.click('[data-testid="run-a"]'));
await page.waitFor(`/Paid/.test(${text("[data-testid=result-a]")})`);
assert(true, "a) executed directly");

log("▶ Step 4b: hire a sub-agent (escrow, then release as owner)");
await signed("b) createEscrow 30 to sub-agent", () => page.click('[data-testid="run-b"]'));
await page.waitFor(`!!document.querySelector('[data-testid="release-b"]')`);
await signed("b) releaseEscrow as owner", () => page.click('[data-testid="release-b"]'));
await page.waitFor(`/Released/.test(${text("[data-testid=result-b]")})`);
assert(true, "b) escrow locked, then released by the owner");

log("▶ Step 4c: pay a human bounty (escrow, then approve & release)");
await signed("c) createEscrow 40 to human", () => page.click('[data-testid="run-c"]'));
await page.waitFor(`!!document.querySelector('[data-testid="release-c"]')`);
await signed("c) releaseEscrow as owner", () => page.click('[data-testid="release-c"]'));
await page.waitFor(`/Released/.test(${text("[data-testid=result-c]")})`);
assert(true, "c) bounty released on approval");

log("▶ Step 4d: over-limit attempt (blocked, nothing sent)");
const sentBefore = page.wallet.sent.length;
await page.click('[data-testid="run-d"]');
await page.waitFor(`!!document.querySelector('[data-testid=result-d]')`);
const dErr = await page.evaluate(text("[data-testid=result-d-error]"));
assert(dErr === "ExceedsPerTxCap()", `d) decoded error ${dErr}`);
assert(page.wallet.sent.length === sentBefore, "d) no transaction was signed or sent");
await page.evaluate(`document.querySelector('[data-testid=result-d]').scrollIntoView({block:'center'})`);
await page.screenshot(shot("playground-blocked.png"), { fullPage: false });

log("▶ Step 4e: needs approval (queued, then approved), and a second one rejected");
await signed("e) pay 75 (above threshold)", () => page.click('[data-testid="run-e"]'));
await page.waitFor(`/Pending/.test(${text("[data-testid=result-e]")}) && !!document.querySelector('[data-testid="approve-e"]')`);
await page.evaluate(`document.querySelector('[data-testid=result-e]').scrollIntoView({block:'center'})`);
await page.screenshot(shot("playground-queued.png"), { fullPage: false });
await signed("e) approveRequest as owner", () => page.click('[data-testid="approve-e"]'));
await page.waitFor(`/Approved/.test(${text("[data-testid=result-e]")})`);
assert(true, "e) queued request approved and paid");
await page.click('[data-testid="e-mode-allowlist"]');
await sleep(300);
await signed("e) pay 10 to a non-allowlisted address", () => page.click('[data-testid="run-e"]'));
await page.waitFor(`/Pending/.test(${text("[data-testid=result-e]")}) && /not allowlisted/.test(${text("[data-testid=result-e]")})`);
await signed("e) rejectRequest as owner", () => page.click('[data-testid="reject-e"]'));
await page.waitFor(`/Rejected/.test(${text("[data-testid=result-e]")})`);
assert(true, "e) non-allowlisted request rejected");

log("▶ Final state + remember my vault across reloads");
await sleep(3000);
await page.screenshot(shot("playground-desktop.png"));
await page.goto(`${APP}/try`);
await page.waitFor(`${stepState(2)} === 'done' && (document.querySelector('.pg-vault-line a')?.getAttribute('title') || '') === ${JSON.stringify(vault)}`, { label: "vault remembered after reload" });
assert(true, "vault remembered (localStorage) and restored after reload");
await page.setViewport(390, 844);
await sleep(2500);
await page.screenshot(shot("playground-phone.png"));

await page.close();
writeFileSync(process.env.BURSAR_E2E_OUT || "stage-c-results.json", JSON.stringify({ wallet: account.address, vault, tx }, null, 2));
log(`\nStage C e2e passed: ${tx.reduce((n, t) => n + t.hashes.length, 0)} transactions via the UI, vault ${vault}`);
process.exit(0);
