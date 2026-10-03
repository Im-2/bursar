// Live vault panels shared by /dashboard and /try. Read-only by default; owner/approver actions appear
// inline only when the connected wallet is allowed to take them.
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { vaultAbi } from "../../abi";
import { addressUrl, chain, txUrl, ZERO_ADDRESS } from "../../lib/chain";
import { decodeBytes32, formatAgo, formatAmount, formatCountdown, formatDateTime, shortAddr, shortHash } from "../../lib/format";
import { useTx, type ContractCall } from "../../lib/tx";
import type { FeedEvent, FeedEventName, VaultData } from "../../lib/useVault";
import { useWallet } from "../../lib/wallet";
import { Badge, Button, Card, KV, Stat, Table, type Tone } from "../ds";
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

function TxLink({ hash }: { hash: Hex }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
      {shortHash(hash)} ↗
    </a>
  );
}

/** A single inline vault action with its own simulate → sign → confirm status. */
export function VaultAction({ ctx, label, functionName, args, confirmText, tone = "default", testId }: {
  ctx: VaultCtx;
  label: string;
  functionName: string;
  args: readonly unknown[];
  confirmText?: string;
  tone?: "default" | "lime";
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
        <Button className={`ds-button--small ${tone === "lime" ? "ds-button--lime" : ""}`} onClick={go} disabled={tx.busy} data-testid={testId}>
          {tx.busy ? "…" : label}
        </Button>
      )}
      <TxStatusLine state={tx.state} />
    </div>
  );
}

const FEED_BADGE: Record<FeedEventName, [string, Tone]> = {
  PaymentExecuted: ["Paid", "green"],
  PaymentQueued: ["Pending", "amber"],
  RequestApproved: ["Approved", "green"],
  RequestRejected: ["Rejected", "red"],
  EscrowCreated: ["Escrow", "lime"],
  EscrowReleased: ["Released", "green"],
  EscrowRefunded: ["Refunded", "gray"],
  TaskOpened: ["Task open", "black"],
  TaskClosed: ["Task closed", "gray"],
};

function feedDetail(e: FeedEvent): string {
  switch (e.name) {
    case "PaymentQueued":
      return `request #${e.refId} · ${e.cause === 1 ? "above threshold" : "not allowlisted"}`;
    case "RequestApproved":
    case "RequestRejected":
      return `request #${e.refId}`;
    case "EscrowCreated":
    case "EscrowReleased":
    case "EscrowRefunded":
      return `escrow #${e.refId}`;
    case "TaskClosed":
      return "unspent budget released";
    case "TaskOpened":
      return "budget reserved";
    default:
      return "";
  }
}

// ---------------------------------------------------------------- panels

export function VaultOverview({ d }: { d: VaultData }) {
  return (
    <div className="ds-grid dash-overview">
      <Card title="Vault" aside={d.paused ? <Badge tone="red">Paused</Badge> : <Badge tone="green">Live</Badge>}>
        <KV
          rows={[
            ["Address", <Addr a={d.vault} />],
            ["Network", `${chain.name} · chain ${chain.id}`],
            ["Token", <>{d.token.symbol} · {d.token.decimals} decimals · <Addr a={d.token.address} /></>],
            ["Owner", <Addr a={d.owner} />],
            ["Escrow approver", d.approver === ZERO_ADDRESS ? "owner only" : <Addr a={d.approver} />],
            ["Allowlist", d.enforceAllowlist ? "enforced" : "off"],
            ["Request TTL", formatCountdown(Number(d.requestTTL))],
          ]}
        />
      </Card>
      <Card title="Balances">
        <div className="dash-balances">
          <Stat label="Token balance">
            <Amount raw={d.balance} d={d} />
          </Stat>
          <Stat label="Free (withdrawable)">
            <Amount raw={d.freeBalance} d={d} />
          </Stat>
          <Stat label="Reserved (tasks + escrows)">
            <Amount raw={d.totalReserved} d={d} />
          </Stat>
        </div>
      </Card>
    </div>
  );
}

export function Agents({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  if (d.agents.length === 0) return <div className="ds-alert">No agents registered yet.</div>;
  return (
    <div className="ds-grid">
      {d.agents.map((a) => {
        const used = a.policy.dailyCap === 0n ? 0 : Number((a.spentToday * 10000n) / a.policy.dailyCap) / 100;
        return (
          <Card
            key={a.address}
            title={<>Agent {decodeBytes32(a.policy.role)}</>}
            aside={a.policy.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Revoked</Badge>}
          >
            <KV
              rows={[
                ["Address", <Addr a={a.address} />],
                ["Per-tx cap", <Amount raw={a.policy.perTxCap} d={d} />],
                ["Daily cap", <Amount raw={a.policy.dailyCap} d={d} />],
                [
                  "Approval above",
                  a.policy.approvalThreshold === 0n ? "every payment" : <Amount raw={a.policy.approvalThreshold} d={d} />,
                ],
                ["Spent today (UTC)", <Amount raw={a.spentToday} d={d} />],
                ["Left today", <span className="ds-data"><Amount raw={a.allowance} d={d} /></span>],
              ]}
            />
            <div className="meter" role="img" aria-label={`${used}% of daily cap used`}>
              <div className="meter__fill" style={{ width: `${Math.min(used, 100)}%` }} />
            </div>
            <div className="ds-label meter__label">{used}% of daily cap used</div>
            <div className="ds-label dash-sub">Allowlisted recipients</div>
            {a.recipients.length + d.globalRecipients.length === 0 ? (
              <p className="dash-muted">{d.enforceAllowlist ? "none: every payment is queued" : "allowlist off"}</p>
            ) : (
              <ul className="dash-list">
                {a.recipients.map((r) => (
                  <li key={r} className="dash-list__row">
                    <Addr a={r} full />
                    {ctx.isOwner && (
                      <VaultAction ctx={ctx} label="Remove" functionName="setAgentRecipient" args={[a.address, r, false]} testId="remove-recipient" />
                    )}
                  </li>
                ))}
                {d.globalRecipients.map((r) => (
                  <li key={`g-${r}`} className="dash-list__row">
                    <span>
                      <Addr a={r} full /> <Badge>vault-wide</Badge>
                    </span>
                    {ctx.isOwner && (
                      <VaultAction ctx={ctx} label="Remove" functionName="setGlobalRecipient" args={[r, false]} />
                    )}
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
  if (d.tasks.length === 0) return <div className="ds-alert">No tasks opened yet.</div>;
  return (
    <div className="ds-grid">
      {[...d.tasks].reverse().map((task) => {
        const left = Number(task.expiry) - t;
        const budget = task.remaining + task.spent;
        const usedPct = budget === 0n ? 0 : Number((task.spent * 10000n) / budget) / 100;
        const status: [string, Tone] = !task.open ? ["Closed", "gray"] : left <= 0 ? ["Expired", "gray"] : ["Open", "green"];
        const canClose = task.open && (ctx.isOwner || (!!ctx.account && left <= 0));
        return (
          <Card key={task.id} title="Task" aside={<Badge tone={status[1]}>{status[0]}</Badge>}>
            <KV
              rows={[
                ["Task id", <span title={task.id}>{shortHash(task.id)}</span>],
                ["Agent", <Addr a={task.agent} />],
                ["Remaining", <span className="ds-data"><Amount raw={task.remaining} d={d} /></span>],
                ["Spent", <Amount raw={task.spent} d={d} />],
                ["Expires", <span className="ds-data">{formatDateTime(task.expiry)}</span>],
                ["Time left", task.open ? <strong>{formatCountdown(left)}</strong> : "—"],
              ]}
            />
            <div className="meter" role="img" aria-label={`${usedPct}% of task budget spent`}>
              <div className="meter__fill" style={{ width: `${Math.min(usedPct, 100)}%` }} />
            </div>
            <div className="ds-label meter__label">{usedPct}% of budget spent</div>
            {canClose && (
              <div className="card-actions">
                <VaultAction
                  ctx={ctx}
                  label="Close task"
                  functionName="closeTask"
                  args={[task.id]}
                  confirmText="Close this task? Its unspent budget returns to free balance."
                  testId="close-task"
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function Queue({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const now = useNow();
  const t = chainNow(d, now);
  const pending = d.requests.filter((r) => r.status === 1);
  const resolved = d.requests.length - pending.length;
  return (
    <Table
      title="Approval queue"
      aside={<span className="ds-table__aside">{pending.length} pending · {resolved} resolved</span>}
      rows={pending}
      rowKey={(r) => r.id.toString()}
      empty="No pending requests. Resolved requests appear in the activity feed."
      columns={[
        { key: "id", header: "#", render: (r) => `#${r.id}` },
        {
          key: "status",
          header: "Status",
          render: (r) => (Number(r.expiresAt) <= t ? <Badge tone="gray">Expired</Badge> : <Badge tone="amber">Pending</Badge>),
        },
        { key: "amount", header: "Amount", render: (r) => <Amount raw={r.amount} d={d} /> },
        { key: "to", header: "Recipient", render: (r) => <Addr a={r.recipient} /> },
        { key: "agent", header: "Agent", render: (r) => <Addr a={r.agent} /> },
        { key: "reason", header: "Reason", render: (r) => decodeBytes32(r.reason) },
        {
          key: "exp",
          header: "Expires",
          render: (r) => (
            <span className="ds-data" title={formatDateTime(r.expiresAt)}>
              {formatCountdown(Number(r.expiresAt) - t)}
            </span>
          ),
        },
        ...(ctx.isOwner
          ? [
              {
                key: "act",
                header: "Owner",
                render: (r: (typeof pending)[number]) => (
                  <div className="ds-actions ds-actions--stack">
                    <VaultAction ctx={ctx} label="Approve" functionName="approveRequest" args={[r.id]} tone="lime" testId={`approve-${r.id}`} />
                    <VaultAction ctx={ctx} label="Reject" functionName="rejectRequest" args={[r.id]} testId={`reject-${r.id}`} />
                  </div>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

export function Escrows({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const now = useNow();
  const t = chainNow(d, now);
  const escrowBadge = (status: number, deadline: bigint): [string, Tone] => {
    if (status === 2) return ["Released", "green"];
    if (status === 3) return ["Refunded", "gray"];
    return Number(deadline) <= t ? ["Refundable", "amber"] : ["Locked", "lime"];
  };
  const locked = d.escrows.filter((e) => e.status === 1).length;
  const canRelease = ctx.isOwner || ctx.isApprover;
  type E = (typeof d.escrows)[number];
  return (
    <Table
      title="Escrows"
      aside={<span className="ds-table__aside">{locked} locked · {d.escrows.length} total</span>}
      rows={[...d.escrows].reverse()}
      rowKey={(e) => e.id.toString()}
      empty="No escrows yet."
      columns={[
        { key: "id", header: "#", render: (e) => `#${e.id}` },
        {
          key: "status",
          header: "Status",
          render: (e) => {
            const [label, tone] = escrowBadge(e.status, e.deadline);
            return <Badge tone={tone}>{label}</Badge>;
          },
        },
        { key: "amount", header: "Amount", render: (e) => <Amount raw={e.amount} d={d} /> },
        { key: "payee", header: "Payee", render: (e) => <Addr a={e.payee} /> },
        { key: "agent", header: "Agent", render: (e) => <Addr a={e.agent} /> },
        { key: "reason", header: "Reason", render: (e) => decodeBytes32(e.reason) },
        {
          key: "deadline",
          header: "Deadline",
          render: (e) => <span className="ds-data">{formatDateTime(e.deadline)}</span>,
        },
        ...(ctx.account
          ? [
              {
                key: "act",
                header: "Actions",
                render: (e: E) => {
                  if (e.status !== 1) return <span className="dash-muted">—</span>;
                  const refundable = Number(e.deadline) <= t;
                  return (
                    <div className="ds-actions ds-actions--stack">
                      {canRelease && (
                        <VaultAction ctx={ctx} label="Release" functionName="releaseEscrow" args={[e.id]} tone="lime" testId={`release-${e.id}`} />
                      )}
                      {refundable && <VaultAction ctx={ctx} label="Refund" functionName="refundEscrow" args={[e.id]} testId={`refund-${e.id}`} />}
                      {!canRelease && !refundable && <span className="dash-muted">owner or approver releases</span>}
                    </div>
                  );
                },
              },
            ]
          : []),
      ]}
    />
  );
}

export function Activity({ d }: { d: VaultData }) {
  const now = useNow(5000);
  const t = chainNow(d, now);
  return (
    <Table
      title="Live activity"
      aside={<span className="ds-table__aside">{d.events.length} events · from vault logs</span>}
      rows={d.events}
      rowKey={(e) => e.key}
      empty="No vault activity yet."
      columns={[
        {
          key: "type",
          header: "Event",
          render: (e) => {
            const [label, tone] = FEED_BADGE[e.name];
            return <Badge tone={tone} title={e.name}>{label}</Badge>;
          },
        },
        { key: "amount", header: "Amount", render: (e) => (e.amount !== undefined ? <Amount raw={e.amount} d={d} /> : "—") },
        {
          key: "to",
          header: "Recipient / agent",
          render: (e) =>
            e.counterparty ? <Addr a={e.counterparty} /> : e.agent ? <>agent <Addr a={e.agent} /></> : "—",
        },
        {
          key: "detail",
          header: "Reason",
          render: (e) => (
            <>
              {e.reason ? <strong>{decodeBytes32(e.reason)}</strong> : null}
              <div className="dash-muted">{feedDetail(e)}</div>
            </>
          ),
        },
        {
          key: "time",
          header: "Time",
          render: (e) => (
            <span title={formatDateTime(e.timestamp)}>
              {formatAgo(t - Number(e.timestamp))}
              <div className="dash-muted">{formatDateTime(e.timestamp)}</div>
            </span>
          ),
        },
        { key: "tx", header: "Tx", render: (e) => <TxLink hash={e.txHash} /> },
      ]}
    />
  );
}
