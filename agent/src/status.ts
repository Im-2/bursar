// Read-only dashboard of the demo vault. Needs no keys.
import { formatUnits } from "viem";
import { deployment, preflight } from "./config.js";
import { allEscrows, allRequests, EscrowStatus, RequestStatus, snapshot } from "./vault.js";
import { addrLink, amt, banner, bold, dim, info, kv, setToken, step } from "./ui.js";

const token = await preflight();
setToken(token);
const s = await snapshot();
const now = BigInt(Math.floor(Date.now() / 1000));

banner("Bursar vault status — Arbitrum Sepolia");
kv("vault", addrLink(deployment.vault));
kv("owner", deployment.owner);
kv("token", `${token.symbol} (${token.decimals} decimals) ${deployment.token}`);
kv("paused", String(s.paused));
kv("vault balance", amt(s.vaultBal));
kv("reserved", amt(s.reserved));
kv("free", amt(s.freeBalance));

step("·", "Demo agent policy");
kv("agent", deployment.agent);
kv("active", String(s.policy.active));
kv("role", Buffer.from(s.policy.role.slice(2), "hex").toString("utf8").replace(/\0+$/, ""));
kv("per-tx cap", amt(s.policy.perTxCap));
kv("daily cap", amt(s.policy.dailyCap));
kv("approval threshold", amt(s.policy.approvalThreshold));
kv("spent today (UTC)", amt(s.spentToday));
kv("remaining today", amt(s.allowance));

step("·", `Task "${deployment.taskLabel}"`);
kv("task id", deployment.taskId);
kv("open", String(s.task.open));
kv("expires", new Date(Number(s.task.expiry) * 1000).toISOString());
kv("remaining budget", amt(s.taskRemaining));
kv("spent", amt(s.task.spent));

step("·", "Approval queue");
const requests = await allRequests();
if (requests.length === 0) info(dim("no requests yet"));
for (const r of requests) {
  const status = r.status === 1 && r.expiresAt <= now ? "Expired" : RequestStatus[r.status];
  info(`#${r.id} ${bold(status.padEnd(8))} ${formatUnits(r.amount, token.decimals).padStart(8)} ${token.symbol} → ${r.recipient}`);
}

step("·", "Escrows");
const escrows = await allEscrows();
if (escrows.length === 0) info(dim("no escrows yet"));
for (const e of escrows) {
  info(
    `#${e.id} ${bold(EscrowStatus[e.status].padEnd(8))} ${formatUnits(e.amount, token.decimals).padStart(8)} ${token.symbol} → ${e.payee}` +
      dim(`  deadline ${new Date(Number(e.deadline) * 1000).toISOString()}`),
  );
}
console.log();
