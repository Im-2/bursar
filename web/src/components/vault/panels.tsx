// Live vault panels shared by /dashboard and /try. Read-only by default; owner/approver actions appear
// inline only when the connected wallet is allowed to take them.
import {
  ArrowDownLeft, ArrowUpRight, Ban, Bot, Check, CircleCheck, CirclePause, CirclePlay, CircleX, Copy, ExternalLink, FolderClosed,
  FolderOpen, Hourglass, Inbox, ListChecks, LockKeyhole, LockOpen, RotateCcw, ShieldCheck, Timer, UserCheck, UserX, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { vaultAbi } from "../../abi";
import { addressUrl, chain, DEPLOYMENT, txUrl, ZERO_ADDRESS } from "../../lib/chain";
import { decodeBytes32, formatAgo, formatAmount, formatCountdown, formatDateTime, shortAddr, shortHash } from "../../lib/format";
import { blockCauseLabel } from "../../lib/labels";
import { useTx, type ContractCall } from "../../lib/tx";
import type { FeedEvent, FeedEventName, VaultData } from "../../lib/useVault";
import { useWallet } from "../../lib/wallet";
import { Badge, Button, Card, EmptyState, IconBox, IconButton, KV, StatBox, UseCaseChip, type Tone } from "../ds";
import { ConfirmButton, TxStatusLine } from "../web3";

// ---------------------------------------------------------------- context & helpers

export type VaultCtx = {
  d: VaultData;
  refresh: () => void;
  isOwner: boolean;
  isApprover: boolean;
  account: Address | null;
};

export function useVaultCtx(d: VaultData, refresh: () => void): VaultCtx {
  const { account, onRightChain } = useWallet();
  const me = onRightChain ? account : null;
  return {
    d,
    refresh,
    account: me,
    isOwner: !!me && me === d.owner,
    isApprover: !!me && d.approver !== ZERO_ADDRESS && me === d.approver,
  };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Chain time estimate: last block timestamp plus local seconds elapsed since that read. */
export function chainNow(d: VaultData, now: number) {
  return Number(d.chainTime) + (now - d.fetchedAt) / 1000;
}

export function Amount({ raw, d, unit = true }: { raw: bigint; d: VaultData; unit?: boolean }) {
  return (
    <span className="amount" title={`${raw.toString()} base units (${d.token.decimals} decimals)`}>
      {formatAmount(raw, d.token.decimals)}
      {unit && <span className="amount__unit"> {d.token.symbol}</span>}
    </span>
  );
}

export function Addr({ a, full = false }: { a: Address; full?: boolean }) {
  return (
    <a href={addressUrl(a)} target="_blank" rel="noreferrer" title={a} className={full ? "addr addr--full" : "addr"}>
      {full ? a : shortAddr(a)}
    </a>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      small
      label={done ? "Copied" : label}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => setDone(false),
        );
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </IconButton>
  );
}

/** A single inline vault action with its own simulate → sign → confirm status. */
export function VaultAction({ ctx, label, functionName, args, confirmText, tone = "default", testId }: {
  ctx: VaultCtx;
  label: string;
  functionName: string;
  args: readonly unknown[];
  confirmText?: string;
  tone?: "default" | "ok";
  testId?: string;
}) {
  const tx = useTx(() => ctx.refresh());
  const call: ContractCall = { address: ctx.d.vault, abi: vaultAbi, functionName, args };
  const go = () => tx.run(label, call);
  return (
    <div className="vault-action">
      {confirmText ? (
        <ConfirmButton label={label} confirmText={confirmText} onConfirm={go} disabled={tx.busy} testId={testId} />
      ) : (
        <Button className={`ds-button--small ${tone === "ok" ? "ds-button--ok" : "ds-button--secondary"}`} onClick={go} disabled={tx.busy} data-testid={testId}>
          {tx.busy ? "Working…" : label}
        </Button>
      )}
      <TxStatusLine state={tx.state} />
    </div>
  );
}

const sumActive = (d: VaultData, pick: (a: VaultData["agents"][number]) => bigint) =>
  d.agents.filter((a) => a.policy.active).reduce((s, a) => s + pick(a), 0n);

// ---------------------------------------------------------------- overview: hero + spend + details

export function VaultHero({ d, title }: { d: VaultData; title: string }) {
  const openTasks = d.tasks.filter((t) => t.open && Number(t.expiry) > Number(d.chainTime)).length;
  const allowance = sumActive(d, (a) => a.allowance);
  return (
    <Card tone="mustard" className="vault-hero">
      <div className="vault-hero__head">
        <span className="vault-hero__icon" aria-hidden="true">
          <LockKeyhole size={28} strokeWidth={2.25} />
        </span>
        <div className="vault-hero__id">
          <h1 className="vault-hero__title">{title}</h1>
          <div className="vault-hero__addr">
            <code title={d.vault}>{shortAddr(d.vault)}</code>
            <CopyButton value={d.vault} label="Copy vault address" />
            <IconButton small label="View vault on Arbiscan" href={addressUrl(d.vault)}>
              <ExternalLink size={15} />
            </IconButton>
          </div>
        </div>
        {d.paused ? <Badge tone="blocked">Paused</Badge> : <Badge tone="ok">Live</Badge>}
      </div>
      <p className="vault-hero__meta">
        Owner <Addr a={d.owner} /> · {d.token.symbol} on {chain.name}
      </p>
      <div className="stat-row">
        <StatBox label="Free balance" title={`${d.freeBalance} base units`}>
          {formatAmount(d.freeBalance, d.token.decimals)}
        </StatBox>
        <StatBox label="Reserved" title={`${d.totalReserved} base units`}>
          {formatAmount(d.totalReserved, d.token.decimals)}
        </StatBox>
        <StatBox label="Allowance left today" title={`${allowance} base units`}>
          {formatAmount(allowance, d.token.decimals)}
        </StatBox>
        <StatBox label="Open tasks">{openTasks}</StatBox>
      </div>
    </Card>
  );
}

export function SpendCard({ d }: { d: VaultData }) {
  const spent = sumActive(d, (a) => a.spentToday);
  const cap = sumActive(d, (a) => a.policy.dailyCap);
  const pct = cap === 0n ? 0 : Math.min(100, Number((spent * 10000n) / cap) / 100);
  const today = Math.floor(Number(d.chainTime) / 86400);
  const blockedToday = d.events.filter((e) => e.name === "PaymentBlocked" && Math.floor(Number(e.timestamp) / 86400) === today).length;
  return (
    <Card tone="pink" className="spend-card">
      <div className="spend-card__top">
        <div>
          <div className="ds-label">Agent spend today (UTC)</div>
          <div className="spend-card__value">
            <Amount raw={spent} d={d} unit={false} /> <span className="spend-card__of">/ {formatAmount(cap, d.token.decimals)} {d.token.symbol}</span>
          </div>
        </div>
        <Badge tone={pct >= 100 ? "blocked" : pct >= 75 ? "pending" : "ok"}>{pct}% of cap</Badge>
      </div>
      <div className="meter" role="img" aria-label={`${pct}% of daily cap used`}>
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="spend-card__foot">
        <Badge tone={blockedToday > 0 ? "blocked" : "neutral"}>
          {blockedToday} blocked attempt{blockedToday === 1 ? "" : "s"} today
        </Badge>
        <span className="ds-label">Daily history: see Spend over time</span>
      </div>
    </Card>
  );
}

export function VaultDetails({ d }: { d: VaultData }) {
  return (
    <Card title="Vault details">
      <KV
        rows={[
          ["Balance", <Amount raw={d.balance} d={d} />],
          ["Token", <>{d.token.symbol} · <Addr a={d.token.address} /></>],
          ["Network", `${chain.name} (${chain.id})`],
          ["Escrow approver", d.approver === ZERO_ADDRESS ? "Owner only" : <Addr a={d.approver} />],
          ["Allowlist", d.enforceAllowlist ? "Enforced" : "Off"],
          ["Request TTL", formatCountdown(Number(d.requestTTL))],
        ]}
      />
    </Card>
  );
}

export function VaultOverview({ d }: { d: VaultData }) {
  return (
    <div className="overview-grid">
      <VaultHero d={d} title={d.vault === DEPLOYMENT.vault ? "Demo vault" : "Vault"} />
      <div className="overview-side">
        <SpendCard d={d} />
        <VaultDetails d={d} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- agents & tasks

export function Agents({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  if (d.agents.length === 0) return <EmptyState icon={<Bot size={20} />} title="No agents yet">Register one in Settings.</EmptyState>;
  return (
    <div className="ds-grid">
      {d.agents.map((a) => {
        const used = a.policy.dailyCap === 0n ? 0 : Math.min(100, Number((a.spentToday * 10000n) / a.policy.dailyCap) / 100);
        return (
          <Card
            key={a.address}
            title={<span className="ds-row"><IconBox bg="var(--c-mint)"><Bot size={20} /></IconBox>{decodeBytes32(a.policy.role)}</span>}
            aside={a.policy.active ? <Badge tone="ok">Active</Badge> : <Badge tone="blocked">{d.events.some((e) => e.name === "AgentRevoked" && e.agent === a.address) ? "Revoked" : "Inactive"}</Badge>}
          >
            <KV
              rows={[
                ["Address", <Addr a={a.address} />],
                ["Per-tx cap", <Amount raw={a.policy.perTxCap} d={d} />],
                ["Daily cap", <Amount raw={a.policy.dailyCap} d={d} />],
                ["Approval above", a.policy.approvalThreshold === 0n ? "Every payment" : <Amount raw={a.policy.approvalThreshold} d={d} />],
                ["Spent today", <Amount raw={a.spentToday} d={d} />],
                ["Left today", <span className="ds-data"><Amount raw={a.allowance} d={d} /></span>],
              ]}
            />
            <div className="meter" role="img" aria-label={`${used}% of daily cap used`}>
              <div className="meter__fill" style={{ width: `${used}%` }} />
            </div>
            <div className="ds-label meter__label">{used}% of daily cap used</div>
            <div className="ds-label dash-sub">Allowlisted recipients</div>
            {a.recipients.length + d.globalRecipients.length === 0 ? (
              <p className="ds-muted">{d.enforceAllowlist ? "None yet: every payment is queued." : "Allowlist is off."}</p>
            ) : (
              <ul className="dash-list">
                {a.recipients.map((r) => (
                  <li key={r} className="dash-list__row">
                    <Addr a={r} full />
                    {ctx.isOwner && <VaultAction ctx={ctx} label="Remove" functionName="setAgentRecipient" args={[a.address, r, false]} testId="remove-recipient" />}
                  </li>
                ))}
                {d.globalRecipients.map((r) => (
                  <li key={`g-${r}`} className="dash-list__row">
                    <span>
                      <Addr a={r} full /> <Badge>Vault-wide</Badge>
                    </span>
                    {ctx.isOwner && <VaultAction ctx={ctx} label="Remove" functionName="setGlobalRecipient" args={[r, false]} />}
                  </li>
                ))}
              </ul>
            )}
            {ctx.isOwner && a.policy.active && (
              <div className="card-actions">
                <VaultAction
                  ctx={ctx}
                  label="Revoke agent"
                  functionName="revokeAgent"
                  args={[a.address]}
                  confirmText={`Revoke ${shortAddr(a.address)}? It stops spending immediately.`}
                  testId="revoke-agent"
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function Tasks({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const now = useNow();
  const t = chainNow(d, now);
  if (d.tasks.length === 0) return <EmptyState icon={<ListChecks size={20} />} title="No tasks yet">Open one in Settings to reserve a budget.</EmptyState>;
  return (
    <div className="ds-grid">
      {[...d.tasks].reverse().map((task) => {
        const left = Number(task.expiry) - t;
        const budget = task.remaining + task.spent;
        const usedPct = budget === 0n ? 0 : Math.min(100, Number((task.spent * 10000n) / budget) / 100);
        const status: [string, Tone] = !task.open ? ["Closed", "neutral"] : left <= 0 ? ["Expired", "neutral"] : ["Open", "ok"];
        const canClose = task.open && (ctx.isOwner || (!!ctx.account && left <= 0));
        const agentRevoked = d.agents.some((a) => a.address === task.agent && !a.policy.active) ||
          d.events.some((e) => e.name === "AgentRevoked" && e.agent === task.agent);
        const closeMe = task.open && agentRevoked && !d.agents.some((a) => a.address === task.agent && a.policy.active);
        return (
          <Card key={task.id} title={<span className="ds-row"><IconBox bg="var(--c-sky)"><ListChecks size={20} /></IconBox>Task {shortHash(task.id)}</span>} aside={<span className="ds-row">{closeMe && <Badge tone="blocked">Close me</Badge>}<Badge tone={status[1]}>{status[0]}</Badge></span>}>
            {closeMe && (
              <p className="ds-note ds-note--pending close-me" data-testid="close-me">
                This task's agent is revoked but its budget is still reserved. Close it to return the unspent budget to free balance.
              </p>
            )}
            <KV
              rows={[
                ["Agent", <span>{<Addr a={task.agent} />}{agentRevoked && <> <Badge tone="blocked">Revoked</Badge></>}</span>],
                ["Remaining", <span className="ds-data"><Amount raw={task.remaining} d={d} /></span>],
                ["Spent", <Amount raw={task.spent} d={d} />],
                ["Expires", formatDateTime(task.expiry)],
                ["Time left", task.open ? <strong>{formatCountdown(left)}</strong> : "—"],
              ]}
            />
            <div className="meter" role="img" aria-label={`${usedPct}% of task budget spent`}>
              <div className="meter__fill" style={{ width: `${usedPct}%` }} />
            </div>
            <div className="ds-label meter__label">{usedPct}% of budget spent</div>
            {canClose && (
              <div className="card-actions">
                <VaultAction ctx={ctx} label="Close task" functionName="closeTask" args={[task.id]} confirmText="Close this task? Its unspent budget returns to free balance." testId="close-task" />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- approvals & escrows (card grids)

export function Queue({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const now = useNow();
  const t = chainNow(d, now);
  const pending = d.requests.filter((r) => r.status === 1);
  const resolved = d.requests.length - pending.length;
  if (pending.length === 0)
    return (
      <EmptyState icon={<Inbox size={20} />} title="Nothing waiting for approval">
        {resolved} resolved request{resolved === 1 ? "" : "s"}; see Activity.
      </EmptyState>
    );
  return (
    <div className="ds-grid" data-testid="approval-grid">
      {pending.map((r) => {
        const expired = Number(r.expiresAt) <= t;
        return (
          <Card key={r.id.toString()} className="item-card" title={<span className="ds-row"><IconBox bg="var(--c-pending)"><Hourglass size={20} /></IconBox>Request #{r.id.toString()}</span>} aside={expired ? <Badge>Expired</Badge> : <Badge tone="pending">Pending</Badge>}>
            <div className="item-card__amount"><Amount raw={r.amount} d={d} /></div>
            <div className="item-card__label"><UseCaseChip reason={r.reason} /></div>
            <KV
              rows={[
                ["To", <Addr a={r.recipient} />],
                ["Agent", <Addr a={r.agent} />],
                ["Reason", decodeBytes32(r.reason)],
                ["Expires", <span title={formatDateTime(r.expiresAt)}>{formatCountdown(Number(r.expiresAt) - t)}</span>],
              ]}
            />
            {ctx.isOwner && (
              <div className="card-actions ds-actions">
                <VaultAction ctx={ctx} label="Approve" functionName="approveRequest" args={[r.id]} tone="ok" testId={`approve-${r.id}`} />
                <VaultAction ctx={ctx} label="Reject" functionName="rejectRequest" args={[r.id]} testId={`reject-${r.id}`} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function Escrows({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const now = useNow();
  const t = chainNow(d, now);
  const canRelease = ctx.isOwner || ctx.isApprover;
  if (d.escrows.length === 0) return <EmptyState icon={<LockKeyhole size={20} />} title="No escrows yet" />;
  return (
    <div className="ds-grid" data-testid="escrow-grid">
      {[...d.escrows].reverse().map((e) => {
        const refundable = e.status === 1 && Number(e.deadline) <= t;
        const [label, tone]: [string, Tone] =
          e.status === 2 ? ["Released", "ok"] : e.status === 3 ? ["Refunded", "neutral"] : refundable ? ["Refundable", "pending"] : ["Locked", "info"];
        return (
          <Card key={e.id.toString()} className="item-card" title={<span className="ds-row"><IconBox bg="var(--c-sky)">{e.status === 2 ? <LockOpen size={20} /> : <LockKeyhole size={20} />}</IconBox>Escrow #{e.id.toString()}</span>} aside={<Badge tone={tone}>{label}</Badge>}>
            <div className="item-card__amount"><Amount raw={e.amount} d={d} /></div>
            <div className="item-card__label"><UseCaseChip reason={e.reason} /></div>
            <KV
              rows={[
                ["Payee", <Addr a={e.payee} />],
                ["Agent", <Addr a={e.agent} />],
                ["Reason", decodeBytes32(e.reason)],
                ["Deadline", formatDateTime(e.deadline)],
              ]}
            />
            {ctx.account && e.status === 1 && (
              <div className="card-actions ds-actions">
                {canRelease && <VaultAction ctx={ctx} label="Release" functionName="releaseEscrow" args={[e.id]} tone="ok" testId={`release-${e.id}`} />}
                {refundable && <VaultAction ctx={ctx} label="Refund" functionName="refundEscrow" args={[e.id]} testId={`refund-${e.id}`} />}
                {!canRelease && !refundable && <span className="ds-muted">The owner or approver releases this.</span>}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- activity feed (stacked cards)

type Group = "payments" | "escrow" | "tasks" | "config" | "funding";
type FeedSpec = { title: string; icon: LucideIcon; bg: string; sign: "-" | "+" | ""; group: Group };

const FEED: Record<FeedEventName, FeedSpec> = {
  PaymentExecuted: { title: "Paid", icon: ArrowUpRight, bg: "var(--c-ok)", sign: "-", group: "payments" },
  PaymentBlocked: { title: "Blocked", icon: Ban, bg: "var(--c-blocked)", sign: "", group: "payments" },
  PaymentQueued: { title: "Queued for approval", icon: Hourglass, bg: "var(--c-pending)", sign: "", group: "payments" },
  RequestApproved: { title: "Request approved", icon: CircleCheck, bg: "var(--c-ok)", sign: "-", group: "payments" },
  RequestRejected: { title: "Request rejected", icon: CircleX, bg: "var(--c-blocked)", sign: "", group: "payments" },
  EscrowCreated: { title: "Escrow locked", icon: LockKeyhole, bg: "var(--c-sky)", sign: "", group: "escrow" },
  EscrowReleased: { title: "Escrow released", icon: LockOpen, bg: "var(--c-ok)", sign: "-", group: "escrow" },
  EscrowRefunded: { title: "Escrow refunded", icon: RotateCcw, bg: "var(--c-neutral)", sign: "+", group: "escrow" },
  TaskOpened: { title: "Task opened", icon: FolderOpen, bg: "var(--c-mint)", sign: "", group: "tasks" },
  TaskClosed: { title: "Task closed", icon: FolderClosed, bg: "var(--c-neutral)", sign: "", group: "tasks" },
  AgentSet: { title: "Agent policy set", icon: Bot, bg: "var(--c-mint)", sign: "", group: "config" },
  AgentRevoked: { title: "Agent revoked", icon: UserX, bg: "var(--c-blocked)", sign: "", group: "config" },
  AgentRecipientSet: { title: "Agent allowlist changed", icon: ListChecks, bg: "var(--c-sky)", sign: "", group: "config" },
  GlobalRecipientSet: { title: "Vault-wide allowlist changed", icon: ListChecks, bg: "var(--c-sky)", sign: "", group: "config" },
  AllowlistModeSet: { title: "Allowlist mode changed", icon: ShieldCheck, bg: "var(--c-sky)", sign: "", group: "config" },
  ApproverSet: { title: "Escrow approver set", icon: UserCheck, bg: "var(--c-sky)", sign: "", group: "config" },
  RequestTTLSet: { title: "Request TTL set", icon: Timer, bg: "var(--c-sky)", sign: "", group: "config" },
  Paused: { title: "Vault paused", icon: CirclePause, bg: "var(--c-blocked)", sign: "", group: "config" },
  Unpaused: { title: "Vault unpaused", icon: CirclePlay, bg: "var(--c-ok)", sign: "", group: "config" },
  Deposited: { title: "Deposit", icon: ArrowDownLeft, bg: "var(--c-mustard)", sign: "+", group: "funding" },
  Withdrawn: { title: "Withdrawal", icon: ArrowUpRight, bg: "var(--c-mustard)", sign: "-", group: "funding" },
};

const GROUPS: { id: Group | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "payments", label: "Payments" },
  { id: "escrow", label: "Escrow" },
  { id: "tasks", label: "Tasks" },
  { id: "config", label: "Config" },
  { id: "funding", label: "Funding" },
];

const SPENDS: FeedEventName[] = [
  "PaymentExecuted", "PaymentBlocked", "PaymentQueued", "RequestApproved", "RequestRejected", "EscrowCreated", "EscrowReleased", "EscrowRefunded",
];

function feedDetail(e: FeedEvent, d: VaultData): string {
  const reason = e.reason ? decodeBytes32(e.reason) : null;
  const to = e.counterparty ? `to ${shortAddr(e.counterparty)}` : null;
  const f = (v: bigint) => formatAmount(v, d.token.decimals);
  switch (e.name) {
    case "PaymentBlocked":
      return [reason, to, `over the ${blockCauseLabel(e.cause)}`, "no funds moved"].filter(Boolean).join(" · ");
    case "PaymentQueued":
      return [reason, to, `request #${e.refId}`, e.cause === 1 ? "above threshold" : "not allowlisted"].filter(Boolean).join(" · ");
    case "RequestApproved":
    case "RequestRejected":
      return [reason, to, `request #${e.refId}`].filter(Boolean).join(" · ");
    case "EscrowCreated":
    case "EscrowReleased":
    case "EscrowRefunded":
      return [reason, e.counterparty ? `payee ${shortAddr(e.counterparty)}` : null, `escrow #${e.refId}`].filter(Boolean).join(" · ");
    case "TaskOpened":
      return `budget reserved for agent ${e.agent ? shortAddr(e.agent) : ""}`;
    case "TaskClosed":
      return "unspent budget returned to free balance";
    case "AgentSet": {
      const p = e.policy!;
      return `${shortAddr(e.agent!)} · ${decodeBytes32(p.role)} · per-tx ${f(p.perTxCap)} · daily ${f(p.dailyCap)} · approval above ${f(p.approvalThreshold)}${p.active ? "" : " · inactive"}`;
    }
    case "AgentRevoked":
      return `${shortAddr(e.agent!)} can no longer spend`;
    case "AgentRecipientSet":
      return `${e.allowed ? "allowed" : "removed"} ${shortAddr(e.counterparty!)} for agent ${shortAddr(e.agent!)}`;
    case "GlobalRecipientSet":
      return `${e.allowed ? "allowed" : "removed"} ${shortAddr(e.counterparty!)} for every agent`;
    case "AllowlistModeSet":
      return e.allowed ? "allowlist enforced" : "allowlist off: any recipient can be paid directly";
    case "ApproverSet":
      return e.counterparty === ZERO_ADDRESS ? "cleared: owner-only releases" : `approver ${shortAddr(e.counterparty!)}`;
    case "RequestTTLSet":
      return `queued requests now expire after ${formatCountdown(Number(e.ttl))}`;
    case "Paused":
    case "Unpaused":
      return `by ${shortAddr(e.counterparty!)}`;
    case "Deposited":
      return `from ${shortAddr(e.counterparty!)}`;
    case "Withdrawn":
      return `to ${shortAddr(e.counterparty!)}`;
    default:
      return [reason, to].filter(Boolean).join(" · ");
  }
}

export function Activity({ d }: { d: VaultData }) {
  const now = useNow(5000);
  const t = chainNow(d, now);
  const [filter, setFilter] = useState<Group | "all">("all");
  const counts: Record<string, number> = {};
  for (const g of GROUPS) counts[g.id] = g.id === "all" ? d.events.length : d.events.filter((e) => FEED[e.name].group === g.id).length;
  const shown = filter === "all" ? d.events : d.events.filter((e) => FEED[e.name].group === filter);
  if (d.events.length === 0) return <EmptyState icon={<ListChecks size={20} />} title="No activity yet" />;
  return (
    <div className="ds-stack">
      <div className="filter-chips" role="group" aria-label="Filter activity by type" data-testid="activity-filters">
        {GROUPS.map((g) => (
          <button key={g.id} type="button" className="filter-chip" aria-pressed={filter === g.id} onClick={() => setFilter(g.id)} data-testid={`filter-${g.id}`}>
            {g.label} <span className="filter-chip__count">{counts[g.id]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState title="Nothing of this type yet" />
      ) : (
        <ol className="feed" data-testid="activity-feed">
          {shown.map((e) => {
            const f = FEED[e.name];
            const Icon = f.icon;
            const isBlocked = e.name === "PaymentBlocked";
            return (
              <li key={e.key} className={`feed-item ${isBlocked ? "feed-item--blocked" : ""}`} data-event={e.name}>
                <IconBox bg={f.bg}>
                  <Icon size={20} />
                </IconBox>
                <div className="feed-item__body">
                  <div className="feed-item__title">
                    {isBlocked ? <Badge tone="blocked">Blocked · {blockCauseLabel(e.cause)}</Badge> : f.title}
                    {SPENDS.includes(e.name) && <UseCaseChip reason={e.reason} />}
                  </div>
                  <div className="feed-item__detail">{feedDetail(e, d)}</div>
                </div>
                <div className="feed-item__side">
                  {e.amount !== undefined && (
                    <div className={`feed-item__amount ${isBlocked ? "feed-item__amount--blocked" : ""}`}>
                      {f.sign}
                      <Amount raw={e.amount} d={d} />
                      {isBlocked && <span className="feed-item__notpaid"> not paid</span>}
                    </div>
                  )}
                  <div className="feed-item__time" title={formatDateTime(e.timestamp)}>
                    {formatAgo(t - Number(e.timestamp))} ·{" "}
                    <a href={txUrl(e.txHash as Hex)} target="_blank" rel="noreferrer" title={e.txHash}>
                      tx {shortHash(e.txHash)}
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
