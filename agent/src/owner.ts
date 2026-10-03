// Owner side: approves the demo agent's pending requests and releases its locked escrows.
// Every action is simulated first as the owner (no key needed), then signed by Foundry's
// `cast send --account <keystore>`, so the owner key never enters this process or the repo.
// `--dry-run` only lists and simulates.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatUnits, type Hex } from "viem";
import { vaultAbi } from "./abi.js";
import { deployment, preflight, publicClient, rpcUrl } from "./config.js";
import { allEscrows, allRequests, revertName, snapshot } from "./vault.js";
import { amt, banner, blocked, bold, dim, fatal, info, kv, ok, setToken, step, tx } from "./ui.js";

const dryRun = process.argv.includes("--dry-run");
const keystoreAccount = process.env.OWNER_ACCOUNT || "deployer";
const vault = { address: deployment.vault, abi: vaultAbi } as const;

function castBin(): string {
  if (process.env.CAST_BIN) return process.env.CAST_BIN;
  const local = join(homedir(), ".foundry", "bin", process.platform === "win32" ? "cast.exe" : "cast");
  return existsSync(local) ? local : "cast";
}

/** Sends with the Foundry keystore. cast prompts for the password on this terminal. */
function castSend(signature: string, id: bigint): Hex {
  console.log(dim(`   cast send … ${signature} ${id} --account ${keystoreAccount}  (enter the keystore password)`));
  const res = spawnSync(
    castBin(),
    ["send", deployment.vault, signature, id.toString(), "--account", keystoreAccount, "--rpc-url", rpcUrl, "--json"],
    { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
  );
  if (res.error) fatal(`could not run cast (${res.error.message}). Install Foundry or set CAST_BIN.`);
  if (res.status !== 0) fatal(`cast send failed (exit ${res.status}). Nothing further was sent.`);
  const receipt = JSON.parse(res.stdout.trim().split("\n").pop()!);
  if (receipt.status !== "0x1") fatal(`transaction ${receipt.transactionHash} reverted`);
  return receipt.transactionHash as Hex;
}

/** Simulates as the owner; returns the custom error name if it would revert. */
async function wouldRevert(functionName: "approveRequest" | "releaseEscrow", id: bigint): Promise<string | null> {
  try {
    await publicClient.simulateContract({ account: deployment.owner, ...vault, functionName, args: [id] });
    return null;
  } catch (err) {
    const name = revertName(err);
    if (!name) throw err;
    return name;
  }
}

// ---------------------------------------------------------------- run

const token = await preflight();
setToken(token);
const now = BigInt(Math.floor(Date.now() / 1000));

banner(`Bursar owner console${dryRun ? " (dry run: nothing will be sent)" : ""}`);
kv("vault", deployment.vault);
kv("owner", deployment.owner);
kv("signer", dryRun ? dim("none (dry run)") : `Foundry keystore "${keystoreAccount}"`);

const onChainOwner = await publicClient.readContract({ ...vault, functionName: "owner" });
if (onChainOwner !== deployment.owner) fatal(`vault owner on-chain is ${onChainOwner}, not ${deployment.owner}`);

const before = await snapshot();
if (before.paused) fatal("the vault is paused; approvals and releases are frozen. Unpause first.");

const pending = (await allRequests()).filter(
  (r) => r.status === 1 && r.expiresAt > now && r.agent === deployment.agent,
);
const locked = (await allEscrows()).filter((e) => e.status === 1 && e.agent === deployment.agent);

step("A", `Pending requests from the demo agent: ${pending.length}`);
if (pending.length === 0) info(dim("nothing to approve (run the agent demo first: npm run agent)"));
for (const r of pending) {
  info(`request #${r.id}: ${amt(r.amount)} → ${r.recipient}`);
  const err = await wouldRevert("approveRequest", r.id);
  if (err) {
    blocked(`approval would revert with ${bold(err)}(); skipping`);
    continue;
  }
  if (dryRun) {
    ok("simulation passes; would approve");
    continue;
  }
  const hash = castSend("approveRequest(uint256)", r.id);
  tx(hash);
  ok(`request #${r.id} approved and paid`);
}

step("B", `Locked escrows from the demo agent: ${locked.length}`);
if (locked.length === 0) info(dim("nothing to release"));
for (const e of locked) {
  info(`escrow #${e.id}: ${amt(e.amount)} → ${e.payee}`);
  const err = await wouldRevert("releaseEscrow", e.id);
  if (err) {
    blocked(`release would revert with ${bold(err)}(); skipping`);
    continue;
  }
  if (dryRun) {
    ok("simulation passes; would release");
    continue;
  }
  const hash = castSend("releaseEscrow(uint256)", e.id);
  tx(hash);
  ok(`escrow #${e.id} released to the payee`);
}

const after = await snapshot();
step("C", "Result");
kv("recipient balance", `${amt(before.recipientBal)} → ${amt(after.recipientBal)}`);
kv("vault balance", `${amt(before.vaultBal)} → ${amt(after.vaultBal)}`);
kv("vault reserved", `${amt(before.reserved)} → ${amt(after.reserved)}`);
kv("task budget left", `${amt(before.taskRemaining)} → ${amt(after.taskRemaining)}`);
kv("agent spent today", `${formatUnits(after.spentToday, token.decimals)} ${token.symbol} ${dim("(approvals never count toward the daily cap)")}`);
console.log();
