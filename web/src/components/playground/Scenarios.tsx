// Step 4 scenario cards: each pre-fills an agent action against the visitor's own vault, explains what it
// demonstrates, runs it (simulate -> sign -> confirm) and shows the decoded on-chain result.
import { useState, type ReactNode } from "react";
import { parseEventLogs, stringToHex, type Address, type Hex, type TransactionReceipt } from "viem";
import { vaultAbi } from "../../abi";
import { parseAddress } from "../../lib/chain";
import { formatAmount, shortAddr } from "../../lib/format";
import type { DemoAddresses } from "../../lib/playground";
import { simulateOnly, useTx, type ContractCall } from "../../lib/tx";
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
    const r = await tx.run("Buy data", { address: d.vault, abi: vaultAbi, functionName: "pay", args: [task.id, addrs.vendor, amount, reason("BUY_DATA")] });
    if (!r) return;
    const ev = vaultEvents(r);
    const paid = ev.find((e) => e.eventName === "PaymentExecuted");
    const queued = ev.find((e) => e.eventName === "PaymentQueued");
    setResult(
      paid ? (
        <div className="scenario__result scenario__result--ok" data-testid="result-a">
          <p>
            <Badge tone="green">Paid</Badge> <Amount raw={amount} d={d} /> went straight to the data vendor <Addr a={addrs.vendor} />: within the per-tx cap, below the approval threshold, to an allowlisted recipient. No human needed.
          </p>
        </div>
      ) : queued ? (
        <div className="scenario__result" data-testid="result-a">
          <p>
            <Badge tone="amber">Queued</Badge> Your approval threshold is 0, so every payment waits for you.
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
      call={<>pay(task, vendor {shortAddr(addrs.vendor)}, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, "BUY_DATA")</>}
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
              <Badge tone="green">Released</Badge> Escrow #{escrowId.toString()} paid <Amount raw={amount} d={d} /> to the {payeeLabel.toLowerCase()} <Addr a={payee} />, only after you, the owner, signed off.
            </p>
          ) : (
            <>
              <p>
                <Badge tone="lime">Locked</Badge> Escrow #{escrowId.toString()}: <Amount raw={amount} d={d} /> moved from the task budget into escrow. The agent can't release it; only the owner (or an approver) can, or it refunds to the vault after the deadline.
              </p>
              {ctx.isOwner && (
                <VaultAction ctx={ctx} label="2 · Release as owner" functionName="releaseEscrow" args={[escrowId]} tone="lime" testId={`release-${testId}`} />
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
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setResult(null);
    const before = { balance: d.balance, remaining: task.remaining };
    const call: ContractCall = { address: d.vault, abi: vaultAbi, functionName: "pay", args: [task.id, addrs.vendor, amount, reason("OVER_LIMIT")] };
    const err = await simulateOnly(ctx.account!, call);
    setBusy(false);
    setResult(
      err?.errorName ? (
        <div className="scenario__result scenario__result--blocked" data-testid="result-d">
          <p>
            <Badge tone="red">Blocked</Badge> The vault rejected it with <code className="tx-status__error" data-testid="result-d-error">{err.errorName}()</code>. The amount <Amount raw={amount} d={d} /> is over the per-tx cap of <Amount raw={policy.perTxCap} d={d} />.
          </p>
          <p className="dash-muted">
            Nothing was signed or sent. Vault balance is still <Amount raw={before.balance} d={d} /> and the task still has <Amount raw={before.remaining} d={d} /> left. A compromised agent key hits the same wall.
          </p>
        </div>
      ) : (
        <div className="scenario__result" data-testid="result-d">
          <p>{err ? err.error : "Unexpected: the simulation passed."}</p>
        </div>
      ),
    );
  }
  return (
    <ScenarioCard
      letter="D"
      title="Over-limit attempt"
      demonstrates={<>An agent (or someone who stole its key) tries to move more than its per-transaction cap. The contract refuses; no transaction is even sent.</>}
      call={<>pay(task, vendor, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, "OVER_LIMIT")</>}
    >
      <div className="ds-actions">
        <Button onClick={run} disabled={busy} data-testid="run-d">{busy ? "Simulating…" : "Try it as agent"}</Button>
      </div>
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
    const r = await tx.run("Needs approval", { address: d.vault, abi: vaultAbi, functionName: "pay", args: [task.id, to, amount, reason("NEEDS_APPROVAL")] });
    if (!r) return;
    const ev = vaultEvents(r).find((e) => e.eventName === "PaymentQueued");
    if (ev && "id" in ev.args) setRequestId(ev.args.id as bigint);
  }

  return (
    <ScenarioCard
      letter="E"
      title="Needs approval"
      demonstrates={<>Anything unusual (a big payment, or an unknown recipient) waits in the approval queue instead of executing. You approve or reject it.</>}
      call={<>pay(task, {mode === "threshold" ? "vendor" : "unknown"} {shortAddr(to)}, {formatAmount(amount, d.token.decimals)} {d.token.symbol}, "NEEDS_APPROVAL")</>}
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
              <Badge tone="green">Approved</Badge> Request #{requestId.toString()} executed: <Amount raw={amount} d={d} /> paid to <Addr a={to} /> with your sign-off. Approvals don't use the agent's daily cap.
            </p>
          ) : request?.status === 3 ? (
            <p>
              <Badge tone="red">Rejected</Badge> Request #{requestId.toString()} was rejected. No funds moved.
            </p>
          ) : (
            <>
              <p>
                <Badge tone="amber">Pending</Badge> Request #{requestId.toString()} is in the approval queue ({mode === "threshold" ? "above the approval threshold" : "recipient not allowlisted"}). No funds moved yet.
              </p>
              {ctx.isOwner && (
                <div className="ds-actions ds-actions--stack">
                  <VaultAction ctx={ctx} label="2 · Approve as owner" functionName="approveRequest" args={[requestId]} tone="lime" testId="approve-e" />
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
        code="SUB_AGENT"
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
        code="BOUNTY"
        testId="c"
        editablePayee
        onPayee={(v) => updateAddrs({ human: v })}
      />
      <OverLimit ctx={ctx} task={task} addrs={addrs} />
      <NeedsApproval ctx={ctx} task={task} addrs={addrs} />
    </div>
  );
}
