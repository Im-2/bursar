// The demo AI agent: acts against the live vault with its own key and narrates every step.
// Signs with AGENT_PRIVATE_KEY from the gitignored repo-root .env. The key is never printed.
import { createWalletClient, http, parseEventLogs, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "./abi.js";
import { chain, deployment, preflight, publicClient, rpcUrl, shortAddr } from "./config.js";
import { revertName, snapshot } from "./vault.js";
import {
  amt, banner, blocked, bold, dim, fatal, info, kv, ok, queued, reason, setToken, step, tx, units,
} from "./ui.js";

// ---------------------------------------------------------------- key handling

function loadAgentAccount() {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();
  delete process.env.AGENT_PRIVATE_KEY; // keep it out of anything that might dump the environment
  if (!raw) fatal("AGENT_PRIVATE_KEY is not set in the repo-root .env. See agent/README.md.");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fatal("AGENT_PRIVATE_KEY is not a 32-byte hex private key (value not shown).");
  const account = privateKeyToAccount(key);
  if (account.address !== deployment.agent) {
    fatal(
      `AGENT_PRIVATE_KEY belongs to ${account.address}, but the demo agent is ${deployment.agent}.\n` +
        "         Put the demo agent's key in .env, or update deployments/arbitrum-sepolia.json.",
    );
  }
  return account;
}

// ---------------------------------------------------------------- setup

const token = await preflight();
setToken(token);
const account = loadAgentAccount();
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const vault = { address: deployment.vault, abi: vaultAbi } as const;

// Demo amounts, chosen relative to the seeded policy (per-tx 100, daily 500, threshold 50).
const DIRECT = units(25); // <= threshold, allowlisted       -> executes
const OVER_CAP = units(150); // > per-tx cap                     -> blocked
const NEEDS_APPROVAL = units(75); // between threshold and per-tx cap -> queued
const ESCROW = units(40); // <= per-tx cap                    -> locked in escrow

async function confirm(hash: Hex): Promise<TransactionReceipt> {
  tx(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fatal(`transaction ${hash} reverted on-chain`);
  kv("block / gas", `${receipt.blockNumber} / ${receipt.gasUsed}`);
  return receipt;
}

// ---------------------------------------------------------------- story

banner("Bursar demo — an AI agent spending under on-chain policy");
kv("network", `Arbitrum Sepolia (chain ${deployment.chainId})`);
kv("vault", deployment.vault);
kv("agent (me)", deployment.agent);
kv("allowlisted recipient", deployment.recipient);

const gas = await publicClient.getBalance({ address: account.address });
kv("agent gas balance", `${Number(gas) / 1e18} ETH`);
if (gas === 0n) fatal("the agent has no ETH for gas on Arbitrum Sepolia.");

// Step 1 ---------------------------------------------------------------------------------------
step(1, "Read my policy, task budget and daily allowance");
const s0 = await snapshot();
if (s0.paused) fatal("the vault is paused by its owner.");
if (!s0.policy.active) fatal("the demo agent has been revoked by the owner.");
kv("per-tx cap", amt(s0.policy.perTxCap));
kv("daily cap", amt(s0.policy.dailyCap));
kv("approval threshold", amt(s0.policy.approvalThreshold));
kv("task", `"${deployment.taskLabel}" ${dim(deployment.taskId)}`);
kv("task budget left", amt(s0.taskRemaining));
kv("allowance left today", amt(s0.allowance));
if (s0.allowance < DIRECT + ESCROW) fatal("not enough daily allowance left for this demo today; run it after 00:00 UTC.");
if (s0.taskRemaining < DIRECT + ESCROW + NEEDS_APPROVAL) fatal("the demo task budget is nearly used up; seed a new task.");
ok("policy loaded: I may spend autonomously up to the threshold, to allowlisted recipients, within my caps");

// Step 2 ---------------------------------------------------------------------------------------
step(2, `Pay ${shortAddr(deployment.recipient)} directly (allowlisted, at or below the threshold)`);
kv("amount", amt(DIRECT));
{
  const { request } = await publicClient.simulateContract({
    account, ...vault, functionName: "pay", args: [deployment.taskId, deployment.recipient, DIRECT, reason("DEMO_PAY")],
  });
  const receipt = await confirm(await wallet.writeContract(request));
  const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "PaymentExecuted" });
  if (!ev) fatal("expected a PaymentExecuted event");
  const s = await snapshot();
  ok(`PaymentExecuted: ${amt(ev.args.amount)} sent to the recipient`);
  kv("recipient balance", `${amt(s0.recipientBal)} → ${amt(s.recipientBal)}`);
  kv("allowance left today", amt(s.allowance));
}

// Step 3 ---------------------------------------------------------------------------------------
step(3, "Try to pay more than my per-tx cap (sent for real, so it lands in the audit trail)");
kv("amount", amt(OVER_CAP));
{
  const BLOCK_CAUSES = ["PerTxCap", "DailyCap", "TaskBudget"] as const;
  const before = await snapshot();
  let request;
  try {
    ({ request } = await publicClient.simulateContract({
      account, ...vault, functionName: "pay", args: [deployment.taskId, deployment.recipient, OVER_CAP, reason("OVER_CAP")],
    }));
  } catch (err) {
    // Vaults deployed before PaymentBlocked existed still revert here.
    const name = revertName(err);
    if (!name) throw err;
    fatal(`this vault reverts with ${name}() instead of logging PaymentBlocked: it predates the audit-trail change. Use the current deployment.`);
  }
  const receipt = await confirm(await wallet.writeContract(request));
  const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "PaymentBlocked" });
  if (!ev) fatal("expected a PaymentBlocked event");
  blocked(`PaymentBlocked: ${amt(ev.args.amount)} refused, cause ${bold(BLOCK_CAUSES[ev.args.cause])} (per-tx cap is ${amt(before.policy.perTxCap)})`);
  info(dim("Note: this is a SUCCESSFUL transaction. Arbiscan shows \"Status: Success\"; the refusal is the"));
  info(dim("PaymentBlocked event in its logs. The vault ran its checks, recorded the refusal and moved nothing."));
  info(dim("(A revert would leave no on-chain record, so the attempt would vanish from the audit trail.)"));
  const after = await snapshot();
  info(dim("the attempt is now on-chain in the audit trail, but nothing moved:"));
  kv("recipient balance", `${amt(before.recipientBal)} → ${amt(after.recipientBal)}`);
  kv("vault balance", `${amt(before.vaultBal)} → ${amt(after.vaultBal)}`);
  kv("task budget left", `${amt(before.taskRemaining)} → ${amt(after.taskRemaining)}`);
  kv("spent today", `${amt(before.spentToday)} → ${amt(after.spentToday)}`);
  const unchanged =
    before.recipientBal === after.recipientBal &&
    before.vaultBal === after.vaultBal &&
    before.taskRemaining === after.taskRemaining &&
    before.spentToday === after.spentToday &&
    before.reserved === after.reserved;
  if (unchanged) ok("balances, task budget and daily allowance unchanged");
  else fatal("state changed during the blocked step (another transaction may have landed concurrently)");
}

// Step 4 ---------------------------------------------------------------------------------------
step(4, "Pay above the approval threshold, which goes to the owner's approval queue");
kv("amount", amt(NEEDS_APPROVAL));
{
  const before = await snapshot();
  const { request, result } = await publicClient.simulateContract({
    account, ...vault, functionName: "pay",
    args: [deployment.taskId, deployment.recipient, NEEDS_APPROVAL, reason("BIG_PURCHASE")],
  });
  if (result[0]) fatal("expected this payment to be queued, but it would execute directly");
  const receipt = await confirm(await wallet.writeContract(request));
  const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "PaymentQueued" });
  if (!ev) fatal("expected a PaymentQueued event");
  const r = await publicClient.readContract({ ...vault, functionName: "getRequest", args: [ev.args.id] });
  const after = await snapshot();
  queued(`PaymentQueued: request #${ev.args.id} (cause: ${ev.args.cause === 1 ? "Threshold" : "Allowlist"})`);
  kv("waiting for", "owner approval (run: npm run owner)");
  kv("expires", new Date(Number(r.expiresAt) * 1000).toISOString());
  kv("recipient balance", `${amt(before.recipientBal)} → ${amt(after.recipientBal)} ${dim("(no funds moved)")}`);
}

// Step 5 ---------------------------------------------------------------------------------------
step(5, "Lock funds in escrow for the recipient");
kv("amount", amt(ESCROW));
{
  const before = await snapshot();
  const deadline = BigInt(Math.min(Math.floor(Date.now() / 1000) + 24 * 3600, Number(before.task.expiry)));
  const { request } = await publicClient.simulateContract({
    account, ...vault, functionName: "createEscrow",
    args: [deployment.taskId, deployment.recipient, ESCROW, deadline, reason("ESCROW_JOB")],
  });
  const receipt = await confirm(await wallet.writeContract(request));
  const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "EscrowCreated" });
  if (!ev) fatal("expected an EscrowCreated event");
  const after = await snapshot();
  ok(`EscrowCreated: escrow #${ev.args.id} locked`);
  kv("release by", "owner or approver (run: npm run owner)");
  kv("refundable after", new Date(Number(deadline) * 1000).toISOString());
  kv("task budget left", `${amt(before.taskRemaining)} → ${amt(after.taskRemaining)}`);
  kv("vault reserved", `${amt(before.reserved)} → ${amt(after.reserved)} ${dim("(moved from task to escrow)")}`);
}

// Summary --------------------------------------------------------------------------------------
const end = await snapshot();
banner("Done: what the vault enforced");
ok(`paid ${amt(DIRECT)} autonomously`);
blocked(`refused ${amt(OVER_CAP)} (per-tx cap), logged on-chain as PaymentBlocked`);
queued(`queued ${amt(NEEDS_APPROVAL)} for the owner`);
ok(`escrowed ${amt(ESCROW)} pending release`);
kv("allowance left today", amt(end.allowance));
kv("task budget left", amt(end.taskRemaining));
console.log(`\n   Next: the owner runs ${bold("npm run owner")} to approve the request and release the escrow.\n`);
