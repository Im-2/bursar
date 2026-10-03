// Polls the live vault. Every value shown on the dashboard comes from here, i.e. from the chain.
import { useEffect, useRef, useState } from "react";
import type { AbiEvent, Address, Hex } from "viem";
import { tokenAbi, vaultAbi } from "../abi";
import { client, DEPLOYMENT, POLL_MS } from "./chain";

const vault = { address: DEPLOYMENT.vault, abi: vaultAbi } as const;
const token = { address: DEPLOYMENT.token, abi: tokenAbi } as const;
const vaultEvents = vaultAbi.filter((x): x is Extract<(typeof vaultAbi)[number], { type: "event" }> => x.type === "event");
const LOG_CHUNK = 500_000n;

export const FEED_EVENTS = [
  "PaymentExecuted",
  "PaymentQueued",
  "RequestApproved",
  "RequestRejected",
  "EscrowCreated",
  "EscrowReleased",
  "EscrowRefunded",
  "TaskOpened",
  "TaskClosed",
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
  cause?: number; // PaymentQueued: 0 = allowlist, 1 = threshold
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

async function readSnapshot(logs: RawLog[]) {
  // Discover agents, recipients and tasks from the event history, then read their current state.
  const agents = new Set<Address>([DEPLOYMENT.demoAgent]);
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

  const [head, symbol, decimals, owner, paused, approver, enforceAllowlist, totalReserved, freeBalance, balance, requestCount, escrowCount] =
    await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.readContract({ ...token, functionName: "symbol" }),
      client.readContract({ ...token, functionName: "decimals" }),
      client.readContract({ ...vault, functionName: "owner" }),
      client.readContract({ ...vault, functionName: "paused" }),
      client.readContract({ ...vault, functionName: "approver" }),
      client.readContract({ ...vault, functionName: "enforceAllowlist" }),
      client.readContract({ ...vault, functionName: "totalReserved" }),
      client.readContract({ ...vault, functionName: "freeBalance" }),
      client.readContract({ ...token, functionName: "balanceOf", args: [DEPLOYMENT.vault] }),
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
    blockNumber: head.number,
    chainTime: head.timestamp,
    token: { symbol, decimals },
    owner,
    paused,
    approver,
    enforceAllowlist,
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

export function useVault() {
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const logsRef = useRef<RawLog[]>([]);
  const nextBlockRef = useRef<bigint>(DEPLOYMENT.vaultDeployBlock);
  const blockTimes = useRef(new Map<bigint, bigint>());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function syncLogs() {
      const latest = await client.getBlockNumber();
      const fresh: RawLog[] = [];
      for (let from = nextBlockRef.current; from <= latest; from += LOG_CHUNK) {
        const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
        const logs = await client.getLogs({
          address: DEPLOYMENT.vault,
          events: vaultEvents as unknown as AbiEvent[],
          fromBlock: from,
          toBlock: to,
        });
        for (const l of logs) {
          fresh.push({
            eventName: (l as { eventName: string }).eventName,
            args: (l as { args: Record<string, unknown> }).args,
            blockNumber: l.blockNumber!,
            logIndex: l.logIndex!,
            transactionHash: l.transactionHash!,
          });
        }
      }
      // Timestamps for new blocks only (cached across polls).
      const missing = [...new Set(fresh.map((l) => l.blockNumber))].filter((b) => !blockTimes.current.has(b));
      const blocks = await Promise.all(missing.map((b) => client.getBlock({ blockNumber: b })));
      blocks.forEach((b) => blockTimes.current.set(b.number, b.timestamp));
      // De-duplicate: React StrictMode (dev) can briefly run two pollers against the same refs.
      const seen = new Set(logsRef.current.map((l) => `${l.transactionHash}-${l.logIndex}`));
      logsRef.current = [...logsRef.current, ...fresh.filter((l) => !seen.has(`${l.transactionHash}-${l.logIndex}`))];
      nextBlockRef.current = latest + 1n;
    }

    async function poll() {
      try {
        await syncLogs();
        const snap = await readSnapshot(logsRef.current);
        const events = logsRef.current
          .map((l) => toFeedEvent(l, blockTimes.current.get(l.blockNumber)!))
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
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(poll, POLL_MS);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { data, error, loading };
}
