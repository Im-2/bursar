// Step 4 scenario cards: each pre-fills an agent action against the visitor's own vault, explains what it
// demonstrates, runs it (simulate -> sign -> confirm) and shows the decoded on-chain result.
import { useState, type ReactNode } from "react";
import { parseEventLogs, stringToHex, type Address, type Hex, type TransactionReceipt } from "viem";
import { tokenAbi, vaultAbi } from "../../abi";
import { client, parseAddress } from "../../lib/chain";
import { blockCauseLabel } from "../../lib/labels";
import { formatAmount, shortAddr } from "../../lib/format";
import type { DemoAddresses } from "../../lib/playground";
import { useTx } from "../../lib/tx";
import { Badge, Button, Card } from "../ds";
import { Addr, Amount, VaultAction, type VaultCtx } from "../vault/panels";
import { Field, TxStatusLine } from "../web3";

type Task = VaultCtx["d"]["tasks"][number];
const reason = (code: string): Hex => stringToHex(code, { size: 32 });
const UNIT = (d: VaultCtx["d"]) => 10n ** BigInt(d.token.decimals);
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

function vaultEvents(receipt: TransactionReceipt) {
  return parseEventLogs({ abi: vaultAbi, logs: receipt.logs });
}

function ScenarioCard({ letter, title, demonstrates, call, children }: {
  letter: string;
  title: string;
  demonstrates: ReactNode;
  call: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="scenario" title={<><span className="scenario__letter">{letter}</span> {title}</>}>
      <p className="scenario__what">{demonstrates}</p>
      <div className="scenario__call">
        <span className="ds-label">Agent call</span>
        <code>{call}</code>
      </div>
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------- a) buy data

function BuyData({ ctx, task, addrs }: { ctx: VaultCtx; task: Task; addrs: DemoAddresses }) {
  const { d } = ctx;
  const policy = d.agents.find((a) => a.address === ctx.account)!.policy;
  const amount = policy.approvalThreshold > 0n ? minBig(policy.approvalThreshold, 20n * UNIT(d)) : 20n * UNIT(d);
  const [result, setResult] = useState<ReactNode>(null);
  const tx = useTx(() => ctx.refresh());
  async function run() {
    setResult(null);
    const r = await tx.run("Buy data", { address: d.vault, abi: vaultAbi, functionName: "pay", args: [task.id, addrs.vendor, amount, reason("DATA_PURCHASE")] });
    if (!r) return;
    const ev = vaultEvents(r);
    const paid = ev.find((e) => e.eventName === "PaymentExecuted");
    const queued = ev.find((e) => e.eventName === "PaymentQueued");
    setResult(
      paid ? (
        <div className="scenario__result scenario__result--ok" data-testid="result-a">
          <p>
            <Badge tone="ok">Paid</Badge> <Amount raw={amount} d={d} /> went straight to the data vendor <Addr a={addrs.vendor} />: within the per-tx cap, below the approval threshold, to an allowlisted recipient. No human needed.
          </p>
        </div>
      ) : queued ? (
        <div className="scenario__result" data-testid="result-a">
          <p>
            <Badge tone="pending">Queued</Badge> Your approval threshold is 0, so every payment waits for you.
          </p>
        </div>
      ) : null,
    );
  }
  return (
    <ScenarioCard
      letter="A"
      title="Buy data"
      demonstrates={<>A routine purchase inside every limit executes instantly. This is the autonomy you <em>do</em> want.</>}
      call={<>pay(task, vendor {shortAddr(addrs.vendor)}, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, "DATA_PURCHASE")</>}
    >
      <div className="ds-actions">
        <Button onClick={run} disabled={tx.busy} data-testid="run-a">Run as agent</Button>
      </div>
      <TxStatusLine state={tx.state} />
      {result}
    </ScenarioCard>
  );
}

// ---------------------------------------------------------------- b/c) escrow then release

function EscrowScenario({ ctx, task, letter, title, demonstrates, payee, payeeLabel, amount, deadlineSecs, code, testId, editablePayee, onPayee }: {
  ctx: VaultCtx;
  task: Task;
  letter: string;
  title: string;
  demonstrates: ReactNode;
  payee: Address;
  payeeLabel: string;
  amount: bigint;
  deadlineSecs: number;
  code: string;
  testId: string;
  editablePayee?: boolean;
  onPayee?: (a: Address) => void;
}) {
  const { d } = ctx;
  const [escrowId, setEscrowId] = useState<bigint | null>(null);
  const [payeeInput, setPayeeInput] = useState<string>(payee);
  const payeeValid = !editablePayee || !!parseAddress(payeeInput);
  const tx = useTx(() => ctx.refresh());
  const escrow = escrowId ? d.escrows.find((e) => e.id === escrowId) : undefined;

  async function run() {
    setEscrowId(null);
    const deadline = BigInt(Math.min(Number(d.chainTime) + deadlineSecs, Number(task.expiry)));
    const r = await tx.run(`${title}: lock escrow`, { address: d.vault, abi: vaultAbi, functionName: "createEscrow", args: [task.id, payee, amount, deadline, reason(code)] });
    if (!r) return;
    const ev = vaultEvents(r).find((e) => e.eventName === "EscrowCreated");
    if (ev && "id" in ev.args) setEscrowId(ev.args.id as bigint);
  }

  return (
    <ScenarioCard
      letter={letter}
      title={title}
      demonstrates={demonstrates}
      call={<>createEscrow(task, {payeeLabel} {shortAddr(payee)}, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, deadline, "{code}")</>}
    >
      {editablePayee && onPayee && (
        <Field label={`${payeeLabel} address`} hint="Any address works; by default a random one with no known key.">
          <input
            className="ds-input"
            value={payeeInput}
            aria-invalid={!payeeValid}
            onChange={(e) => {
              setPayeeInput(e.target.value);
              const a = parseAddress(e.target.value);
              if (a) onPayee(a);
            }}
            name={`${testId}-payee`}
          />
        </Field>
      )}
      <div className="ds-actions">
        <Button onClick={run} disabled={tx.busy || !payeeValid} data-testid={`run-${testId}`}>
          1 · Lock escrow as agent
        </Button>
      </div>
      <TxStatusLine state={tx.state} />
      {escrowId && (
        <div className="scenario__result" data-testid={`result-${testId}`}>
          {escrow?.status === 2 ? (
            <p>
              <Badge tone="ok">Released</Badge> Escrow #{escrowId.toString()} paid <Amount raw={amount} d={d} /> to the {payeeLabel.toLowerCase()} <Addr a={payee} />, only after you, the owner, signed off.
            </p>
          ) : (
            <>
              <p>
                <Badge tone="info">Locked</Badge> Escrow #{escrowId.toString()}: <Amount raw={amount} d={d} /> moved from the task budget into escrow. The agent can't release it; only the owner (or an approver) can, or it refunds to the vault after the deadline.
              </p>
              {ctx.isOwner && (
                <VaultAction ctx={ctx} label="2 · Release as owner" functionName="releaseEscrow" args={[escrowId]} tone="ok" testId={`release-${testId}`} />
              )}
            </>
          )}
        </div>
      )}
    </ScenarioCard>
  );
}

// ---------------------------------------------------------------- d) over-limit attempt

function OverLimit({ ctx, task, addrs }: { ctx: VaultCtx; task: Task; addrs: DemoAddresses }) {
  const { d } = ctx;
  const policy = d.agents.find((a) => a.address === ctx.account)!.policy;
  const amount = policy.perTxCap + 50n * UNIT(d);
  const [result, setResult] = useState<ReactNode>(null);
  const tx = useTx(() => ctx.refresh());

  async function run() {
    setResult(null);
    const before = { balance: d.balance, remaining: task.remaining, spent: d.agents.find((a) => a.address === ctx.account)!.spentToday };
    const r = await tx.run("Over-limit attempt", {
      address: d.vault, abi: vaultAbi, functionName: "pay", args: [task.id, addrs.vendor, amount, reason("DATA_OVERSIZED_ORDER")],
    });
    if (!r) return; // a pre-v2 vault reverts with ExceedsPerTxCap(): the status line shows the decoded name
    const ev = vaultEvents(r).find((e) => e.eventName === "PaymentBlocked");
    if (!ev || !("cause" in ev.args)) {
      setResult(<div className="scenario__result" data-testid="result-d"><p>Unexpected: no PaymentBlocked event in the receipt.</p></div>);
      return;
    }
    // Re-read from the chain right after the receipt: nothing may have moved.
    const [balance, t, spent] = await Promise.all([
      client.readContract({ address: d.token.address, abi: tokenAbi, functionName: "balanceOf", args: [d.vault] }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: "getTask", args: [task.id] }),
      client.readContract({ address: d.vault, abi: vaultAbi, functionName: "spentToday", args: [ctx.account!] }),
    ]);
    const unchanged = balance === before.balance && t.remaining === before.remaining && spent === before.spent;
    setResult(
      <div className="scenario__result scenario__result--blocked" data-testid="result-d">
        <p>
          <Badge tone="blocked">Blocked · <span data-testid="result-d-cause">{blockCauseLabel(Number(ev.args.cause))}</span></Badge>{" "}
          The vault logged <code className="tx-status__error" data-testid="result-d-event">PaymentBlocked</code>: <Amount raw={amount} d={d} /> is over the per-tx cap of{" "}
          <Amount raw={policy.perTxCap} d={d} />.
        </p>
        <p className="ds-muted">
          This was a <strong>successful transaction</strong>: Arbiscan shows Status: Success, with PaymentBlocked in its logs. The vault ran its checks,
          recorded the refusal in the audit trail and moved nothing.
        </p>
        <p className="ds-muted" data-testid="result-d-unchanged" data-unchanged={unchanged}>
          {unchanged ? "Checked on-chain after the receipt: " : "Warning, state changed: "}vault balance <Amount raw={balance} d={d} />, task budget left{" "}
          <Amount raw={t.remaining} d={d} />, agent spent today <Amount raw={spent} d={d} />. A compromised agent key hits the same wall.
        </p>
      </div>,
    );
  }

  return (
    <ScenarioCard
      letter="D"
      title="Over-limit attempt"
      demonstrates={<>An agent (or someone who stole its key) tries to move more than its per-transaction cap. The vault refuses and logs the attempt on-chain, so it shows up in the audit trail.</>}
      call={<>pay(task, vendor, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, "DATA_OVERSIZED_ORDER")</>}
    >
      <div className="ds-actions">
        <Button onClick={run} disabled={tx.busy} data-testid="run-d">Try it as agent</Button>
      </div>
      <TxStatusLine state={tx.state} />
      {result}
    </ScenarioCard>
  );
}

// ---------------------------------------------------------------- e) needs approval

function NeedsApproval({ ctx, task, addrs }: { ctx: VaultCtx; task: Task; addrs: DemoAddresses }) {
  const { d } = ctx;
  const policy = d.agents.find((a) => a.address === ctx.account)!.policy;
  const canThreshold = policy.approvalThreshold < policy.perTxCap;
  const [mode, setMode] = useState<"threshold" | "allowlist">(canThreshold ? "threshold" : "allowlist");
  const unit = UNIT(d);
  const thresholdAmount = ((policy.approvalThreshold + policy.perTxCap) / 2n / unit) * unit || policy.perTxCap;
  const amount = mode === "threshold" ? thresholdAmount : minBig(policy.perTxCap, 10n * unit);
  const to = mode === "threshold" ? addrs.vendor : addrs.stranger;
  const [requestId, setRequestId] = useState<bigint | null>(null);
  const tx = useTx(() => ctx.refresh());
  const request = requestId ? d.requests.find((r) => r.id === requestId) : undefined;

  async function run() {
    setRequestId(null);
    const r = await tx.run("Needs approval", { address: d.vault, abi: vaultAbi, functionName: "pay", args: [task.id, to, amount, reason(mode === "threshold" ? "DATA_LARGE_ORDER" : "API_UNKNOWN_VENDOR")] });
    if (!r) return;
    const ev = vaultEvents(r).find((e) => e.eventName === "PaymentQueued");
    if (ev && "id" in ev.args) setRequestId(ev.args.id as bigint);
  }

  return (
    <ScenarioCard
      letter="E"
      title="Needs approval"
      demonstrates={<>Anything unusual (a big payment, or an unknown recipient) waits in the approval queue instead of executing. You approve or reject it.</>}
      call={<>pay(task, {mode === "threshold" ? "vendor" : "unknown"} {shortAddr(to)}, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, "{mode === "threshold" ? "DATA_LARGE_ORDER" : "API_UNKNOWN_VENDOR"}")</>}
    >
      <div className="ds-actions" role="radiogroup" aria-label="Why it needs approval">
        <label className="ds-check">
          <input type="radio" checked={mode === "threshold"} disabled={!canThreshold} onChange={() => setMode("threshold")} data-testid="e-mode-threshold" /> Above threshold
        </label>
        <label className="ds-check">
          <input type="radio" checked={mode === "allowlist"} onChange={() => setMode("allowlist")} data-testid="e-mode-allowlist" /> Not allowlisted
        </label>
      </div>
      <div className="ds-actions">
        <Button onClick={run} disabled={tx.busy} data-testid="run-e">1 · Pay as agent</Button>
      </div>
      <TxStatusLine state={tx.state} />
      {requestId && (
        <div className="scenario__result" data-testid="result-e">
          {request?.status === 2 ? (
            <p>
              <Badge tone="ok">Approved</Badge> Request #{requestId.toString()} executed: <Amount raw={amount} d={d} /> paid to <Addr a={to} /> with your sign-off. Approvals don't use the agent's daily cap.
            </p>
          ) : request?.status === 3 ? (
            <p>
              <Badge tone="blocked">Rejected</Badge> Request #{requestId.toString()} was rejected. No funds moved.
            </p>
          ) : (
            <>
              <p>
                <Badge tone="pending">Pending</Badge> Request #{requestId.toString()} is in the approval queue ({mode === "threshold" ? "above the approval threshold" : "recipient not allowlisted"}). No funds moved yet.
              </p>
              {ctx.isOwner && (
                <div className="ds-actions ds-actions--stack">
                  <VaultAction ctx={ctx} label="2 · Approve as owner" functionName="approveRequest" args={[requestId]} tone="ok" testId="approve-e" />
                  <VaultAction ctx={ctx} label="Reject" functionName="rejectRequest" args={[requestId]} testId="reject-e" />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </ScenarioCard>
  );
}

// ---------------------------------------------------------------- all scenarios

export function Scenarios({ ctx, task, addrs, updateAddrs }: {
  ctx: VaultCtx;
  task: Task;
  addrs: DemoAddresses;
  updateAddrs: (p: Partial<DemoAddresses>) => void;
}) {
  const { d } = ctx;
  const policy = d.agents.find((a) => a.address === ctx.account)!.policy;
  const unit = UNIT(d);
  return (
    <div className="scenarios" data-testid="scenarios">
      <BuyData ctx={ctx} task={task} addrs={addrs} />
      <EscrowScenario
        ctx={ctx}
        task={task}
        letter="B"
        title="Hire a sub-agent"
        demonstrates={<>Your agent sub-contracts another agent. Payment is locked up-front so the sub-agent knows it's funded, but it only pays out when you release it.</>}
        payee={addrs.subAgent}
        payeeLabel="Sub-agent"
        amount={minBig(policy.perTxCap, 30n * unit)}
        deadlineSecs={3600}
        code="SUBAGENT_HIRE"
        testId="b"
      />
      <EscrowScenario
        ctx={ctx}
        task={task}
        letter="C"
        title="Pay a human bounty"
        demonstrates={<>A person completes a bounty for your agent. The reward sits in escrow; you check the work and release it, or it refunds to the vault after a day.</>}
        payee={addrs.human}
        payeeLabel="Human"
        amount={minBig(policy.perTxCap, 40n * unit)}
        deadlineSecs={86400}
        code="HUMAN_BOUNTY"
        testId="c"
        editablePayee
        onPayee={(v) => updateAddrs({ human: v })}
      />
      <OverLimit ctx={ctx} task={task} addrs={addrs} />
      <NeedsApproval ctx={ctx} task={task} addrs={addrs} />
    </div>
  );
}
