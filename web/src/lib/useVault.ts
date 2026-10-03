// Polls a live BursarVault. Every value the UI shows comes from here, i.e. from the chain.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type AbiEvent, type Address, type Hex } from "viem";
import { tokenAbi, vaultAbi } from "../abi";
import { client, DEPLOYMENT, KNOWN_FACTORIES, POLL_MS } from "./chain";

const vaultEvents = vaultAbi.filter((x): x is Extract<(typeof vaultAbi)[number], { type: "event" }> => x.type === "event");
const vaultCreated = parseAbiItem("event VaultCreated(address indexed owner, address indexed vault, address indexed token)");
// Public RPCs cap eth_getLogs ranges differently (official: 500k+, publicnode: 50k, some free tiers: 10k).
// Start large and step down on a range error; the size that works is remembered for later calls.
const CHUNK_STEPS = [500_000n, 50_000n, 10_000n];
let chunkIndex = 0;

function isRangeError(e: unknown): boolean {
  const text = `${(e as { details?: string }).details ?? ""} ${(e as Error).message ?? ""}`.toLowerCase();
  return /range|block|limit|exceed|too many|10000|50000/.test(text);
}

/** Fetches logs for [from, to] in chunks that the current RPC accepts. */
async function getLogsChunked<T>(from: bigint, to: bigint, fetchRange: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let cursor = from;
  while (cursor <= to) {
    const size = CHUNK_STEPS[chunkIndex];
    const end = cursor + size - 1n < to ? cursor + size - 1n : to;
    try {
      out.push(...(await fetchRange(cursor, end)));
      cursor = end + 1n;
    } catch (e) {
      if (chunkIndex < CHUNK_STEPS.length - 1 && isRangeError(e)) {
        chunkIndex++; // retry the same window with a smaller range
        continue;
      }
      throw e;
    }
  }
  return out;
}

export const FEED_EVENTS = [
  // payments
  "PaymentExecuted",
  "PaymentBlocked",
  "PaymentQueued",
  "RequestApproved",
  "RequestRejected",
  // escrow
  "EscrowCreated",
  "EscrowReleased",
  "EscrowRefunded",
  // tasks
  "TaskOpened",
  "TaskClosed",
  // configuration
  "AgentSet",
  "AgentRevoked",
  "AgentRecipientSet",
  "GlobalRecipientSet",
  "AllowlistModeSet",
  "ApproverSet",
  "RequestTTLSet",
  "Paused",
  "Unpaused",
  // funding
  "Deposited",
  "Withdrawn",
] as const;
export type FeedEventName = (typeof FEED_EVENTS)[number];

export type FeedEvent = {
  key: string;
  name: FeedEventName;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  timestamp: bigint;
  agent?: Address;
  counterparty?: Address; // recipient or payee
  amount?: bigint;
  reason?: Hex;
  taskId?: Hex;
  refId?: bigint; // request or escrow id
  cause?: number; // PaymentQueued: 0 = allowlist, 1 = threshold; PaymentBlocked: 0 per-tx, 1 daily, 2 task budget
  allowed?: boolean; // AgentRecipientSet / GlobalRecipientSet / AllowlistModeSet
  ttl?: bigint; // RequestTTLSet
  policy?: { perTxCap: bigint; dailyCap: bigint; approvalThreshold: bigint; active: boolean; role: Hex }; // AgentSet
};

type RawLog = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
};

export type VaultData = Awaited<ReturnType<typeof readSnapshot>> & {
  events: FeedEvent[];
  fetchedAt: number; // local ms, for "last updated" and ticking countdowns
};

/** Block the vault was created in: known for the demo vault, otherwise from VaultCreated on any known factory. */
async function resolveStartBlock(vaultAddr: Address): Promise<bigint> {
  if (vaultAddr === DEPLOYMENT.vault) return DEPLOYMENT.vaultDeployBlock;
  const latest = await client.getBlockNumber();
  for (const f of KNOWN_FACTORIES) {
    const logs = await getLogsChunked(f.block, latest, (fromBlock, toBlock) =>
      client.getLogs({ address: f.address, event: vaultCreated, args: { vault: vaultAddr }, fromBlock, toBlock }),
    );
    if (logs.length) return logs[0].blockNumber!;
  }
  // Not created by a known factory: still a valid vault, scan from the oldest factory deployment onwards.
  return KNOWN_FACTORIES.reduce((m, f) => (f.block < m ? f.block : m), KNOWN_FACTORIES[0].block);
}

async function readSnapshot(vaultAddr: Address, logs: RawLog[]) {
  const vault = { address: vaultAddr, abi: vaultAbi } as const;

  // Discover agents, recipients and tasks from the event history, then read their current state.
  const agents = new Set<Address>(vaultAddr === DEPLOYMENT.vault ? [DEPLOYMENT.demoAgent] : []);
  const agentRecipientCandidates = new Map<Address, Set<Address>>();
  const globalCandidates = new Set<Address>();
  const taskIds: Hex[] = [];
  for (const l of logs) {
    const a = l.args;
    if (l.eventName === "AgentSet") agents.add(a.agent as Address);
    if (l.eventName === "AgentRecipientSet") {
      const set = agentRecipientCandidates.get(a.agent as Address) ?? new Set<Address>();
      set.add(a.recipient as Address);
      agentRecipientCandidates.set(a.agent as Address, set);
    }
    if (l.eventName === "GlobalRecipientSet") globalCandidates.add(a.recipient as Address);
    if (l.eventName === "TaskOpened" && !taskIds.includes(a.taskId as Hex)) taskIds.push(a.taskId as Hex);
  }

  const tokenAddress = await client.readContract({ ...vault, functionName: "token" });
  const token = { address: tokenAddress, abi: tokenAbi } as const;

  const [head, symbol, decimals, owner, pendingOwner, paused, approver, enforceAllowlist, requestTTL, totalReserved, freeBalance, balance, requestCount, escrowCount] =
    await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.readContract({ ...token, functionName: "symbol" }),
      client.readContract({ ...token, functionName: "decimals" }),
      client.readContract({ ...vault, functionName: "owner" }),
      client.readContract({ ...vault, functionName: "pendingOwner" }),
      client.readContract({ ...vault, functionName: "paused" }),
      client.readContract({ ...vault, functionName: "approver" }),
      client.readContract({ ...vault, functionName: "enforceAllowlist" }),
      client.readContract({ ...vault, functionName: "requestTTL" }),
      client.readContract({ ...vault, functionName: "totalReserved" }),
      client.readContract({ ...vault, functionName: "freeBalance" }),
      client.readContract({ ...token, functionName: "balanceOf", args: [vaultAddr] }),
      client.readContract({ ...vault, functionName: "requestCount" }),
      client.readContract({ ...vault, functionName: "escrowCount" }),
    ]);

  const [agentInfos, globalRecipients, tasks, requests, escrows] = await Promise.all([
    Promise.all(
      [...agents].map(async (agent) => {
        const candidates = [...(agentRecipientCandidates.get(agent) ?? [])];
        const [policy, spentToday, allowance, allowed] = await Promise.all([
          client.readContract({ ...vault, functionName: "getPolicy", args: [agent] }),
          client.readContract({ ...vault, functionName: "spentToday", args: [agent] }),
          client.readContract({ ...vault, functionName: "remainingDailyAllowance", args: [agent] }),
          Promise.all(candidates.map((r) => client.readContract({ ...vault, functionName: "agentAllowlist", args: [agent, r] }))),
        ]);
        return { address: agent, policy, spentToday, allowance, recipients: candidates.filter((_, i) => allowed[i]) };
      }),
    ),
    Promise.all(
      [...globalCandidates].map((r) => client.readContract({ ...vault, functionName: "globalAllowlist", args: [r] })),
    ).then((flags) => [...globalCandidates].filter((_, i) => flags[i])),
    Promise.all(
      taskIds.map(async (id) => ({ id, ...(await client.readContract({ ...vault, functionName: "getTask", args: [id] })) })),
    ),
    requestCount === 0n
      ? Promise.resolve([])
      : client
          .readContract({ ...vault, functionName: "getRequests", args: [1n, requestCount] })
          .then((list) => list.map((r, i) => ({ id: BigInt(i + 1), ...r }))),
    escrowCount === 0n
      ? Promise.resolve([])
      : client
          .readContract({ ...vault, functionName: "getEscrows", args: [1n, escrowCount] })
          .then((list) => list.map((e, i) => ({ id: BigInt(i + 1), ...e }))),
  ]);

  return {
    vault: vaultAddr,
    blockNumber: head.number,
    chainTime: head.timestamp,
    token: { address: tokenAddress, symbol, decimals },
    owner,
    pendingOwner,
    paused,
    approver,
    enforceAllowlist,
    requestTTL,
    totalReserved,
    freeBalance,
    balance,
    agents: agentInfos,
    globalRecipients,
    tasks,
    requests,
    escrows,
  };
}

function toFeedEvent(l: RawLog, timestamp: bigint): FeedEvent | null {
  if (!(FEED_EVENTS as readonly string[]).includes(l.eventName)) return null;
  const a = l.args;
  const base = {
    key: `${l.transactionHash}-${l.logIndex}`,
    name: l.eventName as FeedEventName,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
    txHash: l.transactionHash,
    timestamp,
    agent: a.agent as Address | undefined,
    taskId: a.taskId as Hex | undefined,
    reason: a.reason as Hex | undefined,
    refId: a.id as bigint | undefined,
  };
  switch (l.eventName) {
    case "PaymentBlocked":
      return { ...base, amount: a.amount as bigint, counterparty: a.recipient as Address, cause: Number(a.cause) };
    case "AgentSet":
      return { ...base, policy: a.policy as FeedEvent["policy"] };
    case "AgentRevoked":
      return base;
    case "AgentRecipientSet":
      return { ...base, counterparty: a.recipient as Address, allowed: a.allowed as boolean };
    case "GlobalRecipientSet":
      return { ...base, counterparty: a.recipient as Address, allowed: a.allowed as boolean };
    case "AllowlistModeSet":
      return { ...base, allowed: a.enforced as boolean };
    case "ApproverSet":
      return { ...base, counterparty: a.approver as Address };
    case "RequestTTLSet":
      return { ...base, ttl: a.ttl as bigint };
    case "Paused":
    case "Unpaused":
      return { ...base, counterparty: a.account as Address };
    case "Deposited":
      return { ...base, amount: a.amount as bigint, counterparty: a.from as Address };
    case "Withdrawn":
      return { ...base, amount: a.amount as bigint, counterparty: a.to as Address };
    case "TaskOpened":
      return { ...base, amount: a.budget as bigint };
    case "TaskClosed":
      return { ...base, amount: a.released as bigint };
    case "PaymentQueued":
      return { ...base, amount: a.amount as bigint, counterparty: a.recipient as Address, cause: Number(a.cause) };
    default:
      return { ...base, amount: a.amount as bigint, counterparty: (a.recipient ?? a.payee) as Address };
  }
}

/** Live view of one vault. `refresh()` re-reads immediately (e.g. right after a transaction confirms). */
export function useVault(vaultAddr: Address | null) {
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    if (!vaultAddr) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let again = false;
    let logs: RawLog[] = [];
    let nextBlock: bigint | null = null;
    const blockTimes = new Map<bigint, bigint>();

    async function syncLogs() {
      if (nextBlock === null) nextBlock = await resolveStartBlock(vaultAddr!);
      const latest = await client.getBlockNumber();
      const page = await getLogsChunked(nextBlock, latest, (fromBlock, toBlock) =>
        client.getLogs({ address: vaultAddr!, events: vaultEvents as unknown as AbiEvent[], fromBlock, toBlock }),
      );
      const fresh: RawLog[] = page.map((l) => ({
        eventName: (l as { eventName: string }).eventName,
        args: (l as { args: Record<string, unknown> }).args,
        blockNumber: l.blockNumber!,
        logIndex: l.logIndex!,
        transactionHash: l.transactionHash!,
      }));
      const missing = [...new Set(fresh.map((l) => l.blockNumber))].filter((b) => !blockTimes.has(b));
      const blocks = await Promise.all(missing.map((b) => client.getBlock({ blockNumber: b })));
      blocks.forEach((b) => blockTimes.set(b.number, b.timestamp));
      const seen = new Set(logs.map((l) => `${l.transactionHash}-${l.logIndex}`));
      logs = [...logs, ...fresh.filter((l) => !seen.has(`${l.transactionHash}-${l.logIndex}`))];
      nextBlock = latest + 1n;
    }

    async function poll() {
      if (running) {
        again = true; // a refresh was requested mid-poll; run once more when this one ends
        return;
      }
      running = true;
      if (timer) clearTimeout(timer);
      try {
        await syncLogs();
        const snap = await readSnapshot(vaultAddr!, logs);
        const events = logs
          .map((l) => toFeedEvent(l, blockTimes.get(l.blockNumber)!))
          .filter((e): e is FeedEvent => e !== null)
          .sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : Number(y.blockNumber - x.blockNumber)));
        if (cancelled) return;
        setData({ ...snap, events, fetchedAt: Date.now() });
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
        setError(msg);
      } finally {
        running = false;
        if (!cancelled) {
          setLoading(false);
          if (again) {
            again = false;
            poll();
          } else {
            timer = setTimeout(poll, POLL_MS);
          }
        }
      }
    }

    pollNow.current = poll;
    poll();
    return () => {
      cancelled = true;
      pollNow.current = () => {};
      if (timer) clearTimeout(timer);
    };
  }, [vaultAddr]);

  const refresh = useCallback(() => pollNow.current(), []);
  return { data, error, loading, refresh };
}
