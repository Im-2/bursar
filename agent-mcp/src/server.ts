// Bursar agent MCP server (stdio). Lets an AI agent spend from the live Bursar demo vault, strictly within the
// agent's on-chain policy. The agent has NO owner powers here: there is no tool to change policy, allowlists,
// tasks or pause, and the vault contract would reject such calls from the agent key anyway.
//
// Signs with AGENT_PRIVATE_KEY from the gitignored repo-root .env. The key is never printed, logged or returned
// by any tool. stdout carries the MCP protocol only; diagnostics go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, fallback, formatEther, formatUnits, getAddress,
  hexToString, http, isAddress, parseEventLogs, parseUnits, stringToHex, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { z } from "zod";
import { tokenAbi, vaultAbi } from "./abi.js";

const root = new URL("../../", import.meta.url);
const log = (...a: unknown[]) => console.error("[bursar-mcp]", ...a);

// ---------------------------------------------------------------- config (public data only)

const envPath = fileURLToPath(new URL(".env", root));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const dep = JSON.parse(readFileSync(new URL("deployments/arbitrum-sepolia.json", root), "utf8"));
const VAULT = getAddress(dep.contracts.BursarVault.address);
const TOKEN = getAddress(dep.contracts.MockUSDG.address);
const DEMO_AGENT = getAddress(dep.demo.agent.address);
const DEFAULT_TASK = dep.demo.task.taskId as Hex;
const EXPLORER = "https://sepolia.arbiscan.io";
const RPCS = [process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"];

/** Simulated vendors: real addresses we control on Arbitrum Sepolia, with made-up services and prices. */
const VENDORS = [
  {
    id: "data-api",
    name: "Data API (simulated)",
    address: getAddress(dep.demo.recipient.address),
    price: "20",
    how: "pay directly with `pay` (it is on the agent's allowlist)",
    reasonPrefix: "DATA_ or API_",
  },
  {
    id: "sub-agent",
    name: "Research sub-agent (simulated)",
    address: getAddress("0xc6D1f61Db88a207d1Ee37cE1C6b2A7Ca0b9731Ae"),
    price: "60",
    how: "hire with `create_escrow`; the vault owner releases payment after the work",
    reasonPrefix: "SUBAGENT_",
  },
  {
    id: "human-reviewer",
    name: "Human reviewer (simulated)",
    address: getAddress(dep.deployer),
    price: "40",
    how: "pay a bounty with `create_escrow`; the vault owner releases it on approval",
    reasonPrefix: "HUMAN_ or BOUNTY_",
  },
];

// ---------------------------------------------------------------- key (never printed)

function loadAccount() {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();
  delete process.env.AGENT_PRIVATE_KEY;
  if (!raw) {
    log("AGENT_PRIVATE_KEY is not set in the repo-root .env; refusing to start.");
    process.exit(1);
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    log("AGENT_PRIVATE_KEY is not a 32-byte hex key (value not shown); refusing to start.");
    process.exit(1);
  }
  const account = privateKeyToAccount(key);
  if (account.address !== DEMO_AGENT) {
    log(`AGENT_PRIVATE_KEY belongs to ${account.address}, not the demo agent ${DEMO_AGENT}; refusing to start.`);
    process.exit(1);
  }
  return account;
}

const account = loadAccount();
const transport = fallback(RPCS.map((u) => http(u, { retryCount: 4 })));
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport });
const vault = { address: VAULT, abi: vaultAbi } as const;

// ---------------------------------------------------------------- helpers

const DECIMALS = 6;
const SYMBOL = "mUSDG";
const fmt = (raw: bigint) => `${formatUnits(raw, DECIMALS)} ${SYMBOL}`;
const txLink = (h: Hex) => `${EXPLORER}/tx/${h}`;
const BLOCK_CAUSE = ["over the per-tx cap", "over the daily cap", "over the task budget"];
const QUEUE_CAUSE = ["the recipient is not on the allowlist", "the amount is above the approval threshold"];

const REVERT_HELP: Record<string, string> = {
  AgentInactive: "this agent is not active (revoked or never registered)",
  EnforcedPause: "the vault is paused by its owner",
  TaskNotOpen: "the task is closed or does not exist",
  TaskExpired: "the task has expired",
  TaskAgentMismatch: "the task belongs to another agent",
  ZeroAmount: "the amount is zero",
  ZeroAddress: "the address is zero",
  InvalidRecipient: "the vault cannot pay itself",
  ExceedsPerTxCap: "escrow amount is over the per-tx cap (escrows revert on limits)",
  ExceedsDailyCap: "escrow amount is over today's remaining daily cap (escrows revert on limits)",
  ExceedsTaskBudget: "escrow amount is over the task's remaining budget (escrows revert on limits)",
  InvalidDeadline: "the escrow deadline must be in the future and no later than the task's expiry",
};

function vendorName(a: Address) {
  return VENDORS.find((v) => v.address === a)?.name ?? a;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function parseAmount(v: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(v.trim())) throw new Error(`amount must be a number of ${SYMBOL} with up to 6 decimals, got "${v}"`);
  const raw = parseUnits(v.trim(), DECIMALS);
  if (raw === 0n) throw new Error("amount must be greater than zero");
  return raw;
}

function parseReason(r: string): Hex {
  const code = r.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!code) throw new Error("reason code is required, e.g. DATA_MARKET_PRICES");
  if (new TextEncoder().encode(code).length > 32) throw new Error("reason code must be at most 32 characters");
  return stringToHex(code, { size: 32 });
}

function parseTask(t: string | undefined): Hex {
  if (!t) return DEFAULT_TASK;
  if (!/^0x[0-9a-fA-F]{64}$/.test(t)) throw new Error("taskId must be a 32-byte hex id (omit it to use the demo task)");
  return t as Hex;
}

function parseRecipient(r: string): Address {
  const byId = VENDORS.find((v) => v.id === r.trim().toLowerCase());
  if (byId) return byId.address;
  if (!isAddress(r.trim())) throw new Error(`recipient must be an address or a vendor id (${VENDORS.map((v) => v.id).join(", ")})`);
  return getAddress(r.trim());
}

/** Decoded custom-error name for a reverted simulation, or null if it was some other failure. */
function revertName(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null;
  const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? r.reason ?? "unknown revert") : null;
}

function reverted(name: string) {
  return text(`REVERTED (simulated first, nothing was sent): ${name}()\nMeaning: ${REVERT_HELP[name] ?? "the vault rejected the call"}.`);
}

// ---------------------------------------------------------------- server

const server = new McpServer({ name: "bursar", version: "1.0.0" });

server.registerTool(
  "get_policy_and_budget",
  {
    title: "Get my spending policy and budget",
    description:
      "Read this agent's on-chain policy on the Bursar demo vault: per-transaction cap, daily cap, approval threshold, what it has spent today, the task budget left, whether the vault is paused, and which vendors are allowlisted. Call this before spending.",
    inputSchema: { taskId: z.string().optional().describe("Task id (bytes32 hex). Omit to use the demo task.") },
    annotations: { readOnlyHint: true },
  },
  async ({ taskId }) => {
    const task = parseTask(taskId);
    const [policy, spent, allowance, t, paused, enforced, eth, vaultBal, allowed] = await Promise.all([
      publicClient.readContract({ ...vault, functionName: "getPolicy", args: [account.address] }),
      publicClient.readContract({ ...vault, functionName: "spentToday", args: [account.address] }),
      publicClient.readContract({ ...vault, functionName: "remainingDailyAllowance", args: [account.address] }),
      publicClient.readContract({ ...vault, functionName: "getTask", args: [task] }),
      publicClient.readContract({ ...vault, functionName: "paused" }),
      publicClient.readContract({ ...vault, functionName: "enforceAllowlist" }),
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [VAULT] }),
      Promise.all(VENDORS.map((v) => publicClient.readContract({ ...vault, functionName: "isRecipientAllowed", args: [account.address, v.address] }))),
    ]);
    const now = Number((await publicClient.getBlock()).timestamp);
    const taskLine = !t.open
      ? "closed or unknown"
      : Number(t.expiry) <= now
        ? "expired"
        : `open, ${fmt(t.remaining)} left of ${fmt(t.remaining + t.spent)}, expires ${new Date(Number(t.expiry) * 1000).toISOString()}`;
    return text(
      [
        `Agent ${account.address} on vault ${VAULT} (Arbitrum Sepolia, testnet, mock token ${SYMBOL})`,
        `Status: ${policy.active ? "active" : "NOT ACTIVE (revoked)"}${paused ? ", VAULT PAUSED" : ""}`,
        `Role: ${hexToString(policy.role, { size: 32 }).replace(/\0+$/, "")}`,
        `Per-transaction cap: ${fmt(policy.perTxCap)} (larger payments are BLOCKED and logged)`,
        `Approval threshold: ${fmt(policy.approvalThreshold)} (larger payments are QUEUED for the owner)`,
        `Daily cap: ${fmt(policy.dailyCap)}; spent today (UTC): ${fmt(spent)}; left today: ${fmt(allowance)}`,
        `Task ${task}: ${taskLine}`,
        `Vault balance: ${fmt(vaultBal)}; agent gas: ${formatEther(eth)} ETH`,
        `Allowlist ${enforced ? "enforced" : "off"}:`,
        ...VENDORS.map((v, i) => `  - ${v.name} ${v.address}: ${allowed[i] ? "allowlisted" : "not allowlisted (a direct pay would be queued for approval)"}`),
      ].join("\n"),
    );
  },
);

server.registerTool(
  "list_vendors",
  {
    title: "List vendors",
    description:
      "List the simulated vendors this agent can buy from: a data API, a research sub-agent and a human reviewer. Each has a real Arbitrum Sepolia address we control and a made-up price in mUSDG.",
    annotations: { readOnlyHint: true },
  },
  async () =>
    text(
      [
        "Simulated vendors (testnet; the services are made up, the addresses are real and controlled by the Bursar team):",
        ...VENDORS.map((v) => `- ${v.id}: ${v.name}\n  address ${v.address}\n  price ${v.price} ${SYMBOL}\n  how to pay: ${v.how}\n  reason code prefix: ${v.reasonPrefix}`),
      ].join("\n"),
    ),
);

server.registerTool(
  "pay",
  {
    title: "Pay from the vault",
    description:
      "Pay a recipient from the vault on behalf of this agent. The vault enforces the policy: the result is PAID, QUEUED FOR APPROVAL (owner must approve), or BLOCKED (over a cap or the task budget, logged on-chain). Simulated before sending. Use a reason code with a prefix: DATA_/API_ for data or services, SUBAGENT_ for sub-agents, HUMAN_/BOUNTY_ for people.",
    inputSchema: {
      recipient: z.string().describe("Recipient address, or a vendor id from list_vendors (e.g. data-api)"),
      amount: z.string().describe("Amount in mUSDG, e.g. \"20\" or \"12.5\""),
      reason: z.string().describe("Short reason code (A-Z, 0-9, _; max 32 chars), e.g. DATA_MARKET_PRICES"),
      taskId: z.string().optional().describe("Task id (bytes32 hex). Omit to use the demo task."),
    },
  },
  async ({ recipient, amount, reason, taskId }) => {
    let to: Address, raw: bigint, code: Hex, task: Hex;
    try {
      to = parseRecipient(recipient);
      raw = parseAmount(amount);
      code = parseReason(reason);
      task = parseTask(taskId);
    } catch (e) {
      return text(`INVALID INPUT (nothing sent): ${(e as Error).message}`);
    }
    let request;
    try {
      ({ request } = await publicClient.simulateContract({ account, ...vault, functionName: "pay", args: [task, to, raw, code] }));
    } catch (e) {
      const name = revertName(e);
      if (name) return reverted(name);
      throw e;
    }
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const link = `Tx: ${hash}\nArbiscan: ${txLink(hash)}`;
    if (receipt.status !== "success") return text(`REVERTED ON-CHAIN (unexpected)\n${link}`);
    const events = parseEventLogs({ abi: vaultAbi, logs: receipt.logs });
    const paid = events.find((e) => e.eventName === "PaymentExecuted");
    const queued = events.find((e) => e.eventName === "PaymentQueued");
    const blocked = events.find((e) => e.eventName === "PaymentBlocked");
    log(`pay ${fmt(raw)} -> ${to}: ${paid ? "paid" : queued ? "queued" : blocked ? "blocked" : "?"} ${hash}`);
    if (paid) return text(`PAID: ${fmt(raw)} to ${vendorName(to)} (${to}).\n${link}`);
    if (queued && "id" in queued.args && "cause" in queued.args) {
      return text(
        `QUEUED FOR APPROVAL: request #${queued.args.id} for ${fmt(raw)} to ${vendorName(to)}, because ${QUEUE_CAUSE[Number(queued.args.cause)]}. No funds moved; the vault owner must approve or reject it.\n${link}`,
      );
    }
    if (blocked && "cause" in blocked.args) {
      return text(
        `BLOCKED: ${fmt(raw)} to ${vendorName(to)} is ${BLOCK_CAUSE[Number(blocked.args.cause)]}. The vault refused it and logged PaymentBlocked; no funds moved.\nThis is a successful transaction: Arbiscan shows Status: Success with the PaymentBlocked event in its logs.\n${link}`,
      );
    }
    return text(`UNKNOWN RESULT: no payment event in the receipt.\n${link}`);
  },
);

server.registerTool(
  "create_escrow",
  {
    title: "Lock payment in escrow",
    description:
      "Lock part of the task budget in escrow for a payee (a sub-agent or a human). Funds are released only by the vault owner (or approver), or refunded to the vault after the deadline. Counts toward the per-tx and daily caps; unlike pay, an escrow over a limit reverts (nothing is sent). Use SUBAGENT_ or HUMAN_/BOUNTY_ reason codes.",
    inputSchema: {
      payee: z.string().describe("Payee address, or a vendor id from list_vendors (e.g. sub-agent, human-reviewer)"),
      amount: z.string().describe("Amount in mUSDG, e.g. \"40\""),
      deadlineSeconds: z.number().int().positive().describe("Seconds from now until the escrow can be refunded (capped at the task's expiry)"),
      reason: z.string().describe("Short reason code, e.g. SUBAGENT_RESEARCH or HUMAN_REVIEW"),
      taskId: z.string().optional().describe("Task id (bytes32 hex). Omit to use the demo task."),
    },
  },
  async ({ payee, amount, deadlineSeconds, reason, taskId }) => {
    let to: Address, raw: bigint, code: Hex, task: Hex;
    try {
      to = parseRecipient(payee);
      raw = parseAmount(amount);
      code = parseReason(reason);
      task = parseTask(taskId);
    } catch (e) {
      return text(`INVALID INPUT (nothing sent): ${(e as Error).message}`);
    }
    const [block, t] = await Promise.all([publicClient.getBlock(), publicClient.readContract({ ...vault, functionName: "getTask", args: [task] })]);
    let deadline = block.timestamp + BigInt(deadlineSeconds);
    const capped = deadline > t.expiry && t.expiry > block.timestamp;
    if (capped) deadline = t.expiry;
    let request;
    try {
      ({ request } = await publicClient.simulateContract({ account, ...vault, functionName: "createEscrow", args: [task, to, raw, deadline, code] }));
    } catch (e) {
      const name = revertName(e);
      if (name) return reverted(name);
      throw e;
    }
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const link = `Tx: ${hash}\nArbiscan: ${txLink(hash)}`;
    if (receipt.status !== "success") return text(`REVERTED ON-CHAIN (unexpected)\n${link}`);
    const ev = parseEventLogs({ abi: vaultAbi, logs: receipt.logs }).find((e) => e.eventName === "EscrowCreated");
    log(`escrow ${fmt(raw)} -> ${to}: ${hash}`);
    if (ev && "id" in ev.args) {
      return text(
        `ESCROW LOCKED: escrow #${ev.args.id} holds ${fmt(raw)} for ${vendorName(to)} (${to}). Only the vault owner or approver can release it; after ${new Date(Number(deadline) * 1000).toISOString()}${capped ? " (capped at the task's expiry)" : ""} anyone can refund it to the vault.\n${link}`,
      );
    }
    return text(`UNKNOWN RESULT: no EscrowCreated event in the receipt.\n${link}`);
  },
);

await server.connect(new StdioServerTransport());
log(`ready: agent ${account.address}, vault ${VAULT}`);
