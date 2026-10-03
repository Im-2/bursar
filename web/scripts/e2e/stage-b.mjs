// Stage B end-to-end: owner console against a fresh vault owned by a throwaway test wallet.
// Usage (dev server running):  BURSAR_TEST_WALLET_FILE=/path/wallet.json node scripts/e2e/stage-b.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { decodeEventLog, keccak256, maxUint256, parseUnits, stringToHex, toHex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import deployment from "../../../deployments/arbitrum-sepolia.json" with { type: "json" };
import { tokenAbi, vaultAbi } from "../../src/abi.ts";
import { clients, launch, loadTestAccount, sleep } from "./harness.mjs";

const APP = process.env.APP_URL || "http://localhost:5173";
const SHOTS = new URL("../../../docs/screenshots/", import.meta.url);
mkdirSync(SHOTS, { recursive: true });
const shot = (name) => new URL(name, SHOTS).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const log = (...a) => console.log(...a);
const U = (n) => parseUnits(String(n), 6);
const randomAddr = () => privateKeyToAddress(generatePrivateKey()); // fresh address; its key is discarded

const factory = deployment.contracts.BursarFactory.address;
const token = deployment.contracts.MockUSDG.address;
const factoryAbi = [
  { type: "function", name: "createVault", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "address" }] },
  { type: "event", name: "VaultCreated", inputs: [{ name: "owner", type: "address", indexed: true }, { name: "vault", type: "address", indexed: true }, { name: "token", type: "address", indexed: true }] },
];

const account = loadTestAccount();
const { publicClient, walletClient } = clients(account);
const me = account.address;
const results = { wallet: me, setup: [], ui: [] };

async function send(label, params) {
  const hash = await walletClient.writeContract(params);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  results.setup.push({ label, hash });
  log(`  setup ✓ ${label}  ${hash}`);
  return r;
}

// ---------------------------------------------------------------- 1. seed a vault owned by the test wallet
log(`test wallet ${me}  balance ${(await publicClient.getBalance({ address: me })) / 10n ** 12n} µETH`);
const created = await send("createVault", { address: factory, abi: factoryAbi, functionName: "createVault", args: [token] });
const vault = created.logs
  .map((l) => { try { return decodeEventLog({ abi: factoryAbi, ...l }); } catch { return null; } })
  .find((e) => e?.eventName === "VaultCreated").args.vault;
results.vault = vault;
log(`vault ${vault}`);

const R1 = randomAddr(), R2 = randomAddr(), R3 = randomAddr(), R4 = randomAddr();
const task1 = keccak256(toHex("e2e-task-1"));
const now = Number((await publicClient.getBlock()).timestamp);
const V = { address: vault, abi: vaultAbi };
await send("mint", { address: token, abi: tokenAbi, functionName: "mint", args: [me, U(2000)] });
await send("approve", { address: token, abi: tokenAbi, functionName: "approve", args: [vault, maxUint256] });
await send("deposit", { ...V, functionName: "deposit", args: [U(2000)] });
await send("setAgent(self)", { ...V, functionName: "setAgent", args: [me, { perTxCap: U(100), dailyCap: U(500), approvalThreshold: U(50), active: true, role: stringToHex("E2E", { size: 32 }) }] });
await send("allowlist R1", { ...V, functionName: "setAgentRecipient", args: [me, R1, true] });
await send("openTask", { ...V, functionName: "openTask", args: [task1, me, U(1000), BigInt(now + 7 * 86400)] });
await send("pay 60 (queued #1)", { ...V, functionName: "pay", args: [task1, R1, U(60), stringToHex("E2E_Q1", { size: 32 })] });
await send("pay 70 (queued #2)", { ...V, functionName: "pay", args: [task1, R1, U(70), stringToHex("E2E_Q2", { size: 32 })] });
await send("escrow 30 (#1)", { ...V, functionName: "createEscrow", args: [task1, R2, U(30), BigInt(now + 86400), stringToHex("E2E_E1", { size: 32 })] });
const shortDeadline = Number((await publicClient.getBlock()).timestamp) + 75;
await send("escrow 20 (#2, 75s deadline)", { ...V, functionName: "createEscrow", args: [task1, R2, U(20), BigInt(shortDeadline), stringToHex("E2E_E2", { size: 32 })] });

// ---------------------------------------------------------------- 2. drive the UI as the owner
const page = await launch({ account, startChainId: 1, log });
const step = (s) => log(`\n▶ ${s}`);

async function uiTx(label, clickSelector, { confirm = false, scope } = {}) {
  const before = page.wallet.sent.length;
  await page.click(clickSelector);
  if (confirm) {
    await sleep(200);
    await page.click(clickSelector.replace(/"\]$/, '-confirm"]'));
  }
  await page.waitFor(`true`, { timeout: 100 });
  const end = Date.now() + 90000;
  while (page.wallet.sent.length === before) {
    if (scope) {
      const r = await page.evaluate(`(() => { const s=[...document.querySelectorAll(${JSON.stringify(scope)} + ' [data-testid=tx-status]')].pop(); return s ? {st:s.dataset.status, name:s.querySelector('[data-testid=tx-error-name]')?.textContent, text:s.textContent} : null })()`);
      if (r?.st === "failed") throw new Error(`${label} failed in UI: ${r.text}`);
    }
    if (Date.now() > end) throw new Error(`${label}: wallet never asked to sign`);
    await sleep(300);
  }
  const hash = page.wallet.sent[page.wallet.sent.length - 1];
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted on-chain`);
  results.ui.push({ label, hash });
  log(`  ui ✓ ${label}  ${hash}`);
  await sleep(2500); // let the dashboard refresh
  return hash;
}

step("Demo vault, wallet not connected: read-only with a connect hint");
await page.goto(`${APP}/dashboard`);
await page.waitFor(`!!document.querySelector('[data-testid=owner-hint]')`);
log("  hint:", await page.evaluate(`document.querySelector('[data-testid=owner-hint]').textContent`));

step("Connect: wallet starts on chain 1, app prompts to switch to Arbitrum Sepolia");
await page.connect(); // modal -> EIP-6963 test wallet -> switch prompt
log("  wallet chain now", page.wallet.chainId);
await page.waitFor(`/owner is/.test(document.querySelector('[data-testid=owner-hint]')?.textContent || '')`);
log("  non-owner hint:", await page.evaluate(`document.querySelector('[data-testid=owner-hint]').textContent`));
await page.screenshot(shot("stage-b-demo-vault-not-owner.png"), { fullPage: false });

step("Open the test wallet's own vault: owner console appears");
await page.goto(`${APP}/dashboard?vault=${vault}`);
await page.waitFor(`!!document.querySelector('[data-testid=form-agent]')`, { label: "owner console" });
await page.waitFor(`!!document.querySelector('[data-testid="approve-1"]')`, { label: "pending request #1" });
await page.screenshot(shot("stage-b-owner-console-before.png"));

step("Approve request #1, reject request #2");
await uiTx("approveRequest #1", '[data-testid="approve-1"]');
await uiTx("rejectRequest #2", '[data-testid="reject-2"]');

step("Release escrow #1");
await uiTx("releaseEscrow #1", '[data-testid="release-1"]');

step("Decoded error: open a task larger than the free balance");
await page.fill('[data-testid=form-task] input[name=label]', "e2e-too-big");
await page.fill('[data-testid=form-task] input[name=budget]', "999999");
await page.click('[data-testid="submit-task"]');
const tooBig = await page.txResult('[data-testid=form-task]', { expect: "failed" });
log(`  blocked before signing: ${tooBig.errorName}`);
results.decodedError = tooBig.errorName;
await page.evaluate(`document.querySelector('[data-testid=form-task]').scrollIntoView({block:'center'})`);
await page.screenshot(shot("stage-b-decoded-error.png"), { fullPage: false });

step("Open a task, then close it");
await page.fill('[data-testid=form-task] input[name=label]', "e2e-task-2");
await page.fill('[data-testid=form-task] input[name=budget]', "100");
await page.fill('[data-testid=form-task] select[name=agent]', me);
await uiTx("openTask e2e-task-2", '[data-testid="submit-task"]', { scope: "[data-testid=form-task]" });
await uiTx("closeTask e2e-task-2", '[data-testid="close-task"]', { confirm: true });

step("Update the agent policy");
await page.fill('[data-testid=form-agent] input[name=agent]', me);
await sleep(300);
await page.fill('[data-testid=form-agent] input[name=threshold]', "40");
await page.fill('[data-testid=form-agent] input[name=role]', "E2E-UPDATED");
await uiTx("setAgent (threshold 40, role E2E-UPDATED)", '[data-testid="submit-agent"]', { scope: "[data-testid=form-agent]" });

step("Allowlist a recipient, toggle enforce-allowlist off and on");
await page.fill('[data-testid=form-allowlist] input[name=recipient]', R3);
await uiTx("setAgentRecipient R3", '[data-testid="submit-allow"]', { scope: "[data-testid=form-allowlist]" });
await uiTx("setEnforceAllowlist(false)", '[data-testid="toggle-allowlist"]');
await uiTx("setEnforceAllowlist(true)", '[data-testid="toggle-allowlist"]');

step("Set approver, request TTL");
await page.fill('[data-testid=form-settings] input[name=approver]', R4);
await uiTx("setApprover R4", '[data-testid="submit-approver"]', { scope: "[data-testid=form-settings]" });
await page.fill('[data-testid=form-settings] input[name=ttl]', "48");
await uiTx("setRequestTTL 48h", '[data-testid="submit-ttl"]', { scope: "[data-testid=form-settings]" });

step("Pause (with confirmation), then unpause");
await uiTx("pause", '[data-testid="pause"]', { confirm: true });
await page.waitFor(`/Vault is paused/i.test(document.body.textContent)`);
await page.screenshot(shot("stage-b-paused.png"), { fullPage: false });
await uiTx("unpause", '[data-testid="unpause"]');

step("Refund escrow #2 after its deadline");
while (Number((await publicClient.getBlock()).timestamp) <= shortDeadline) await sleep(3000);
await page.waitFor(`!!document.querySelector('[data-testid="refund-2"]')`, { timeout: 60000, label: "refund button" });
await uiTx("refundEscrow #2", '[data-testid="refund-2"]');

step("Revoke the agent (with confirmation)");
await uiTx("revokeAgent", '[data-testid="revoke-agent"]', { confirm: true });
await page.waitFor(`/Revoked/i.test(document.body.textContent)`);
await page.screenshot(shot("stage-b-owner-console-after.png"));

await page.setViewport(390, 844);
await sleep(1500);
await page.screenshot(shot("stage-b-owner-console-phone.png"));

await page.close();
writeFileSync(process.env.BURSAR_E2E_OUT || "stage-b-results.json", JSON.stringify(results, null, 2));
log(`\nStage B e2e passed: ${results.setup.length} setup txs, ${results.ui.length} UI txs, decoded error ${results.decodedError}`);
process.exit(0);
