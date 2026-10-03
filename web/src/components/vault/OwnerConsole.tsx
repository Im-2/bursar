// Owner console: forms for every owner-only setting. Rendered only when the connected wallet is the owner.
import { useState, type FormEvent } from "react";
import { keccak256, parseUnits, stringToHex, toHex, type Address } from "viem";
import { vaultAbi } from "../../abi";
import { parseAddress, ZERO_ADDRESS } from "../../lib/chain";
import { formatAmount, shortAddr } from "../../lib/format";
import { useTx } from "../../lib/tx";
import { Button, Card } from "../ds";
import { ConfirmButton, Field, TxStatusLine } from "../web3";
import type { VaultCtx } from "./panels";

const MAX_TTL_HOURS = 30 * 24;

/** Whole/decimal token amount -> base units, or null if invalid. */
export function parseAmount(value: string, decimals: number): bigint | null {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  try {
    return parseUnits(v, decimals);
  } catch {
    return null;
  }
}

function useVaultTx(ctx: VaultCtx) {
  const tx = useTx(() => ctx.refresh());
  const run = (label: string, functionName: string, args: readonly unknown[]) =>
    tx.run(label, { address: ctx.d.vault, abi: vaultAbi, functionName, args });
  return { ...tx, runVault: run };
}

// ---------------------------------------------------------------- agent policy

function AgentPolicyForm({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const dec = d.token.decimals;
  const tx = useVaultTx(ctx);
  const [agent, setAgent] = useState("");
  const [perTx, setPerTx] = useState("100");
  const [daily, setDaily] = useState("500");
  const [threshold, setThreshold] = useState("50");
  const [role, setRole] = useState("AGENT");
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function prefill(addr: string) {
    setAgent(addr);
    const a = d.agents.find((x) => x.address === parseAddress(addr));
    if (!a) return;
    setPerTx(formatAmount(a.policy.perTxCap, dec).replace(/,/g, ""));
    setDaily(formatAmount(a.policy.dailyCap, dec).replace(/,/g, ""));
    setThreshold(formatAmount(a.policy.approvalThreshold, dec).replace(/,/g, ""));
    setRole(decodeRole(a.policy.role));
    setActive(a.policy.active);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const addr = parseAddress(agent);
    const p = parseAmount(perTx, dec);
    const dl = parseAmount(daily, dec);
    const th = parseAmount(threshold, dec);
    if (!addr) return setErr("Agent must be a valid address.");
    if (p === null || dl === null || th === null) return setErr("Caps must be numbers (whole or decimal tokens).");
    if (new TextEncoder().encode(role).length > 32) return setErr("Role must be at most 32 bytes.");
    tx.runVault(`Set policy for ${shortAddr(addr)}`, "setAgent", [
      addr,
      { perTxCap: p, dailyCap: dl, approvalThreshold: th, active, role: stringToHex(role, { size: 32 }) },
    ]);
  }

  return (
    <Card title="Agent policy">
      <form className="ds-form" onSubmit={submit} data-testid="form-agent">
        <Field label="Agent address" hint={d.agents.length ? "Pick an existing agent to edit it, or paste a new address." : undefined}>
          <input className="ds-input" list="known-agents" value={agent} onChange={(e) => prefill(e.target.value)} placeholder="0x…" name="agent" />
          <datalist id="known-agents">
            {d.agents.map((a) => (
              <option key={a.address} value={a.address} />
            ))}
          </datalist>
        </Field>
        <div className="ds-form__row">
          <Field label={`Per-tx cap (${d.token.symbol})`}>
            <input className="ds-input" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} name="perTx" />
          </Field>
          <Field label={`Daily cap (${d.token.symbol})`}>
            <input className="ds-input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} name="daily" />
          </Field>
          <Field label="Approval above" hint="0 = every payment needs approval">
            <input className="ds-input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} name="threshold" />
          </Field>
        </div>
        <div className="ds-form__row">
          <Field label="Role label">
            <input className="ds-input" value={role} maxLength={32} onChange={(e) => setRole(e.target.value)} name="role" />
          </Field>
          <label className="ds-check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        </div>
        <p className="field__hint">The vault enforces 0 &lt; per-tx ≤ daily and threshold ≤ per-tx (InvalidPolicy otherwise).</p>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="ds-actions">
          <Button type="submit" disabled={tx.busy} data-testid="submit-agent">Save policy</Button>
        </div>
        <TxStatusLine state={tx.state} />
      </form>
    </Card>
  );
}

function decodeRole(role: `0x${string}`): string {
  const bytes = role.slice(2).match(/../g)!.map((h) => parseInt(h, 16));
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return String.fromCharCode(...bytes.slice(0, end));
}

// ---------------------------------------------------------------- open task

function OpenTaskForm({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const tx = useVaultTx(ctx);
  const [label, setLabel] = useState(() => `task-${new Date().toISOString().slice(0, 16)}`);
  const [agent, setAgent] = useState<string>(d.agents.find((a) => a.policy.active)?.address ?? "");
  const [budget, setBudget] = useState("100");
  const [days, setDays] = useState("7");
  const [err, setErr] = useState<string | null>(null);
  const taskId = label.trim() ? keccak256(toHex(label.trim())) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const addr = parseAddress(agent);
    const b = parseAmount(budget, d.token.decimals);
    const nDays = Number(days);
    if (!taskId) return setErr("Give the task a label; its id is keccak256(label).");
    if (!addr) return setErr("Agent must be a valid address.");
    if (b === null || b === 0n) return setErr("Budget must be a positive number.");
    if (!(nDays > 0)) return setErr("Duration must be positive.");
    const expiry = BigInt(Math.floor(Number(d.chainTime) + nDays * 86400));
    tx.runVault(`Open task "${label.trim()}"`, "openTask", [taskId, addr, b, expiry]);
  }

  return (
    <Card title="Open task">
      <form className="ds-form" onSubmit={submit} data-testid="form-task">
        <Field label="Label" hint={taskId ? `task id ${taskId.slice(0, 10)}…${taskId.slice(-6)} (ids are never reusable)` : undefined}>
          <input className="ds-input" value={label} onChange={(e) => setLabel(e.target.value)} name="label" />
        </Field>
        <Field label="Agent">
          <select className="ds-select" value={agent} onChange={(e) => setAgent(e.target.value)} name="agent">
            <option value="">Choose an agent…</option>
            {d.agents.map((a) => (
              <option key={a.address} value={a.address} disabled={!a.policy.active}>
                {a.address} {a.policy.active ? "" : "(revoked)"}
              </option>
            ))}
          </select>
        </Field>
        <div className="ds-form__row">
          <Field label={`Budget (${d.token.symbol})`} hint={`free: ${formatAmount(d.freeBalance, d.token.decimals)}`}>
            <input className="ds-input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} name="budget" />
          </Field>
          <Field label="Duration (days)">
            <input className="ds-input" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} name="days" />
          </Field>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="ds-actions">
          <Button type="submit" disabled={tx.busy} data-testid="submit-task">Open task</Button>
        </div>
        <TxStatusLine state={tx.state} />
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- allowlists

function AllowlistForm({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const tx = useVaultTx(ctx);
  const modeTx = useVaultTx(ctx);
  const [scope, setScope] = useState<"agent" | "global">("agent");
  const [agent, setAgent] = useState<string>(d.agents[0]?.address ?? "");
  const [recipient, setRecipient] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submit(allowed: boolean) {
    setErr(null);
    const r = parseAddress(recipient);
    if (!r) return setErr("Recipient must be a valid address.");
    if (scope === "global") return tx.runVault(`${allowed ? "Allow" : "Remove"} ${shortAddr(r)} vault-wide`, "setGlobalRecipient", [r, allowed]);
    const a = parseAddress(agent);
    if (!a) return setErr("Choose an agent.");
    tx.runVault(`${allowed ? "Allow" : "Remove"} ${shortAddr(r)} for ${shortAddr(a)}`, "setAgentRecipient", [a, r, allowed]);
  }

  return (
    <Card title="Recipient allowlist">
      <div className="ds-form" data-testid="form-allowlist">
        <div className="ds-actions" role="radiogroup" aria-label="Allowlist scope">
          <label className="ds-check">
            <input type="radio" name="scope" checked={scope === "agent"} onChange={() => setScope("agent")} /> One agent
          </label>
          <label className="ds-check">
            <input type="radio" name="scope" checked={scope === "global"} onChange={() => setScope("global")} /> Vault-wide
          </label>
        </div>
        {scope === "agent" && (
          <Field label="Agent">
            <select className="ds-select" value={agent} onChange={(e) => setAgent(e.target.value)} name="allow-agent">
              {d.agents.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.address}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Recipient">
          <input className="ds-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" name="recipient" />
        </Field>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="ds-actions">
          <Button onClick={() => submit(true)} disabled={tx.busy} data-testid="submit-allow">Allow</Button>
          <Button className="ds-button--ghost" onClick={() => submit(false)} disabled={tx.busy}>Remove</Button>
        </div>
        <TxStatusLine state={tx.state} />
        <hr className="rule" />
        <div className="ds-actions">
          <span className="ds-label">Allowlist is {d.enforceAllowlist ? "enforced" : "off"}</span>
          <Button
            className="ds-button--small"
            disabled={modeTx.busy}
            onClick={() => modeTx.runVault(d.enforceAllowlist ? "Turn allowlist off" : "Enforce allowlist", "setEnforceAllowlist", [!d.enforceAllowlist])}
            data-testid="toggle-allowlist"
          >
            {d.enforceAllowlist ? "Turn off" : "Enforce"}
          </Button>
        </div>
        <p className="field__hint">Off: any recipient can be paid directly (the approval threshold still applies).</p>
        <TxStatusLine state={modeTx.state} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- vault settings

function SettingsForm({ ctx }: { ctx: VaultCtx }) {
  const { d } = ctx;
  const approverTx = useVaultTx(ctx);
  const ttlTx = useVaultTx(ctx);
  const pauseTx = useVaultTx(ctx);
  const [approver, setApprover] = useState<string>(d.approver === ZERO_ADDRESS ? "" : d.approver);
  const [ttlHours, setTtlHours] = useState(String(Number(d.requestTTL) / 3600));
  const [err, setErr] = useState<string | null>(null);

  function saveApprover(clear: boolean) {
    setErr(null);
    const a: Address | null = clear ? ZERO_ADDRESS : parseAddress(approver);
    if (!a) return setErr("Approver must be a valid address (or clear it).");
    approverTx.runVault(clear ? "Clear approver" : `Set approver ${shortAddr(a)}`, "setApprover", [a]);
  }

  function saveTtl() {
    setErr(null);
    const h = Number(ttlHours);
    if (!(h > 0) || h > MAX_TTL_HOURS) return setErr(`TTL must be between 0 and ${MAX_TTL_HOURS} hours (30 days).`);
    ttlTx.runVault(`Set request TTL to ${h}h`, "setRequestTTL", [BigInt(Math.round(h * 3600))]);
  }

  return (
    <Card title="Vault settings">
      <div className="ds-form" data-testid="form-settings">
        <Field label="Escrow approver" hint="Releases escrows besides the owner. Must be trusted, never an agent key.">
          <input className="ds-input" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="0x… (empty = owner only)" name="approver" />
        </Field>
        <div className="ds-actions">
          <Button className="ds-button--small" onClick={() => saveApprover(false)} disabled={approverTx.busy} data-testid="submit-approver">Set approver</Button>
          <Button className="ds-button--small ds-button--ghost" onClick={() => saveApprover(true)} disabled={approverTx.busy || d.approver === ZERO_ADDRESS}>
            Clear
          </Button>
        </div>
        <TxStatusLine state={approverTx.state} />
        <hr className="rule" />
        <Field label="Request TTL (hours)" hint="How long a queued payment stays approvable. Max 720h (30 days).">
          <input className="ds-input" inputMode="decimal" value={ttlHours} onChange={(e) => setTtlHours(e.target.value)} name="ttl" />
        </Field>
        <div className="ds-actions">
          <Button className="ds-button--small" onClick={saveTtl} disabled={ttlTx.busy} data-testid="submit-ttl">Save TTL</Button>
        </div>
        <TxStatusLine state={ttlTx.state} />
        {err && <p className="form-error" role="alert">{err}</p>}
        <hr className="rule" />
        <div className="ds-actions">
          <span className="ds-label">Vault is {d.paused ? "paused" : "live"}</span>
          {d.paused ? (
            <Button className="ds-button--ok" onClick={() => pauseTx.runVault("Unpause vault", "unpause", [])} disabled={pauseTx.busy} data-testid="unpause">
              Unpause
            </Button>
          ) : (
            <ConfirmButton
              label="Pause vault"
              confirmText="Freeze all agent payments, approvals and releases?"
              onConfirm={() => pauseTx.runVault("Pause vault", "pause", [])}
              disabled={pauseTx.busy}
              testId="pause"
            />
          )}
        </div>
        <TxStatusLine state={pauseTx.state} />
      </div>
    </Card>
  );
}

export function OwnerConsole({ ctx }: { ctx: VaultCtx }) {
  return (
    <div className="ds-grid owner-grid">
      <AgentPolicyForm ctx={ctx} />
      <OpenTaskForm ctx={ctx} />
      <AllowlistForm ctx={ctx} />
      <SettingsForm ctx={ctx} />
    </div>
  );
}
