// /try: a testnet sandbox where a visitor creates and drives their OWN vault with their own wallet.
// The deployer's demo vault is never touched from here.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keccak256, parseEventLogs, stringToHex, toHex, type Address } from "viem";
import { factoryAbi, tokenAbi, vaultAbi } from "../abi";
import { AppShell } from "../components/AppShell";
import { Badge, Button, Card, SectionTitle, type Tone } from "../components/ds";
import { Scenarios } from "../components/playground/Scenarios";
import { parseAmount } from "../components/vault/OwnerConsole";
import { Activity, Addr, Amount, Escrows, Queue, useVaultCtx, VaultOverview, type VaultCtx } from "../components/vault/panels";
import { Field, formatEth, NetworkBanner, TxStatusLine, WalletButton } from "../components/web3";
import { chain, DEPLOYMENT, parseAddress } from "../lib/chain";
import { decodeBytes32, formatAmount, formatCountdown, shortAddr } from "../lib/format";
import { useDemoAddresses, useMyVaults, useWalletToken, type DemoAddresses } from "../lib/playground";
import { useTx } from "../lib/tx";
import { useVault, type VaultData } from "../lib/useVault";
import { useWallet } from "../lib/wallet";
import "./dashboard.css";
import "./playground.css";

const LOW_ETH = 500_000_000_000_000n; // 0.0005 ETH: enough for a full playground run on Arbitrum Sepolia
const FAUCETS = [
  ["OpenFaucet (proof-of-work, no login)", "https://openfaucet.org/arbitrum-sepolia"],
  ["Alchemy faucet", "https://www.alchemy.com/faucets/arbitrum-sepolia"],
  ["QuickNode faucet", "https://faucet.quicknode.com/arbitrum/sepolia"],
  ["Faucet directory", "https://arbitrum.faucet.dev/ArbSepolia"],
] as const;

type StepState = "done" | "current" | "locked";
const STEP_BADGE: Record<StepState, [string, Tone]> = { done: ["Done", "ok"], current: ["Now", "pending"], locked: ["Locked", "neutral"] };

function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children: ReactNode }) {
  const [label, tone] = STEP_BADGE[state];
  return (
    <section className={`pg-step pg-step--${state}`} data-testid={`step-${n}`} data-state={state} aria-label={`Step ${n}: ${title}`}>
      <header className="pg-step__head">
        <span className="pg-step__num">{n}</span>
        <h3 className="pg-step__title">{title}</h3>
        <Badge tone={tone}>{label}</Badge>
      </header>
      {state !== "locked" && <div className="pg-step__body">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- step 1

function WalletStep() {
  const w = useWallet();
  return (
    <div className="ds-form">
      <div className="ds-actions">
        <WalletButton />
      </div>
      {w.account && !w.onRightChain && <p className="field__hint">Switch to {chain.name} (chain {chain.id}) to continue.</p>}
      {w.account && w.onRightChain && w.balance !== null && (
        <>
          <p>
            Gas balance: <strong data-testid="pg-eth">{formatEth(w.balance)} ETH</strong> on {chain.name}.
          </p>
          {w.balance < LOW_ETH && (
            <div className="ds-note ds-note--pending" data-testid="faucets">
              <strong>Low on test ETH.</strong> You need a little for gas (about 0.0005 ETH covers the whole playground). Free faucets:
              <ul className="pg-links">
                {FAUCETS.map(([name, url]) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer">{name} ↗</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- step 2

function VaultStep({ my, onCreated, d, token, refreshVault }: {
  my: ReturnType<typeof useMyVaults>;
  onCreated: (v: Address) => void;
  d: VaultData | null;
  token: ReturnType<typeof useWalletToken>;
  refreshVault: () => void;
}) {
  const w = useWallet();
  const createTx = useTx();
  const mintTx = useTx(() => token.refresh());
  const depositTx = useTx(() => {
    token.refresh();
    refreshVault();
  });
  const [mintAmt, setMintAmt] = useState("1000");
  const [depositAmt, setDepositAmt] = useState("1000");
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    const r = await createTx.run("Create my vault", { address: DEPLOYMENT.factory, abi: factoryAbi, functionName: "createVault", args: [DEPLOYMENT.token] });
    if (!r) return;
    const ev = parseEventLogs({ abi: factoryAbi, logs: r.logs }).find((e) => e.eventName === "VaultCreated");
    if (ev) onCreated(ev.args.vault as Address);
  }

  async function mint(e: FormEvent) {
    e.preventDefault();
    const amt = parseAmount(mintAmt, 6);
    if (!amt) return setErr("Mint amount must be a positive number.");
    setErr(null);
    await mintTx.run(`Mint ${mintAmt} mUSDG to me`, { address: DEPLOYMENT.token, abi: tokenAbi, functionName: "mint", args: [w.account!, amt] });
  }

  async function deposit(e: FormEvent) {
    e.preventDefault();
    const amt = parseAmount(depositAmt, 6);
    if (!amt || !my.selected) return setErr("Deposit amount must be a positive number.");
    if ((token.balance ?? 0n) < amt) return setErr("Mint enough mock USDG to your wallet first.");
    setErr(null);
    if ((token.allowance ?? 0n) < amt) {
      const ok = await depositTx.run("Approve the vault to pull mUSDG", { address: DEPLOYMENT.token, abi: tokenAbi, functionName: "approve", args: [my.selected, amt] });
      if (!ok) return;
    }
    await depositTx.run(`Deposit ${depositAmt} mUSDG`, { address: my.selected, abi: vaultAbi, functionName: "deposit", args: [amt] });
  }

  return (
    <div className="ds-form">
      {my.vaults && my.vaults.length > 0 && (
        <Field label="Your vaults" hint="Created by this wallet through the Bursar factory. Pick one to resume.">
          <select className="ds-select" value={my.selected ?? ""} onChange={(e) => my.select(parseAddress(e.target.value))} name="my-vault" data-testid="vault-select">
            <option value="">Choose a vault…</option>
            {my.vaults.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="ds-actions">
        <Button onClick={create} disabled={createTx.busy} data-testid="create-vault">
          {my.vaults?.length ? "Create a new vault" : "Create my vault"}
        </Button>
        <span className="field__hint">BursarFactory.createVault(MockUSDG): you become the owner.</span>
      </div>
      <TxStatusLine state={createTx.state} />

      {my.selected && (
        <>
          <p className="pg-vault-line">
            Your vault: <Addr a={my.selected} full /> · <Link to={`/dashboard?vault=${my.selected}`}>open in dashboard</Link>
          </p>
          <div className="ds-form__row">
            <form className="ds-form" onSubmit={mint} data-testid="form-mint">
              <Field label="Mint mock USDG to me" hint={`In wallet: ${token.balance !== undefined ? formatAmount(token.balance, 6) : "…"} mUSDG`}>
                <input className="ds-input" inputMode="decimal" value={mintAmt} onChange={(e) => setMintAmt(e.target.value)} name="mint" />
              </Field>
              <Button type="submit" className="ds-button--small" disabled={mintTx.busy} data-testid="mint">Mint</Button>
              <TxStatusLine state={mintTx.state} />
            </form>
            <form className="ds-form" onSubmit={deposit} data-testid="form-deposit">
              <Field label="Deposit into my vault" hint={d ? `In vault: ${formatAmount(d.balance, 6)} mUSDG` : undefined}>
                <input className="ds-input" inputMode="decimal" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} name="deposit" />
              </Field>
              <Button type="submit" className="ds-button--small" disabled={depositTx.busy} data-testid="deposit">Approve &amp; deposit</Button>
              <TxStatusLine state={depositTx.state} />
            </form>
          </div>
          {err && <p className="form-error" role="alert">{err}</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- step 3

function SetupStep({ ctx, addrs, updateAddrs, myTask }: {
  ctx: VaultCtx;
  addrs: DemoAddresses;
  updateAddrs: (p: Partial<DemoAddresses>) => void;
  myTask: VaultData["tasks"][number] | undefined;
}) {
  const { d } = ctx;
  const me = ctx.account!;
  const mine = d.agents.find((a) => a.address === me);
  const [perTx, setPerTx] = useState("100");
  const [daily, setDaily] = useState("500");
  const [threshold, setThreshold] = useState("50");
  const [role, setRole] = useState("PLAYGROUND");
  const [vendor, setVendor] = useState<string>(addrs.vendor);
  useEffect(() => setVendor(addrs.vendor), [addrs.vendor]);
  const [budget, setBudget] = useState("500");
  const [days, setDays] = useState("7");
  const [err, setErr] = useState<string | null>(null);
  const policyTx = useTx(() => ctx.refresh());
  const allowTx = useTx(() => ctx.refresh());
  const taskTx = useTx(() => ctx.refresh());
  const vendorAllowed = !!mine?.recipients.includes(addrs.vendor) || d.globalRecipients.includes(addrs.vendor) || !d.enforceAllowlist;

  function savePolicy(e: FormEvent) {
    e.preventDefault();
    const p = parseAmount(perTx, 6), dl = parseAmount(daily, 6), th = parseAmount(threshold, 6);
    if (p === null || dl === null || th === null) return setErr("Caps must be numbers.");
    setErr(null);
    policyTx.run("Register me as an agent", {
      address: d.vault, abi: vaultAbi, functionName: "setAgent",
      args: [me, { perTxCap: p, dailyCap: dl, approvalThreshold: th, active: true, role: stringToHex(role.slice(0, 32), { size: 32 }) }],
    });
  }

  function allow(e: FormEvent) {
    e.preventDefault();
    const v = parseAddress(vendor);
    if (!v) return setErr("Recipient must be a valid address.");
    setErr(null);
    updateAddrs({ vendor: v });
    allowTx.run(`Allowlist ${shortAddr(v)}`, { address: d.vault, abi: vaultAbi, functionName: "setAgentRecipient", args: [me, v, true] });
  }

  function openTask(e: FormEvent) {
    e.preventDefault();
    const b = parseAmount(budget, 6);
    const nDays = Number(days);
    if (!b || !(nDays > 0)) return setErr("Budget and duration must be positive.");
    setErr(null);
    const label = `playground-${Date.now()}`;
    taskTx.run("Open a task", {
      address: d.vault, abi: vaultAbi, functionName: "openTask",
      args: [keccak256(toHex(label)), me, b, BigInt(Math.floor(Number(d.chainTime) + nDays * 86400))],
    });
  }

  return (
    <div className="pg-setup">
      <form className="ds-form pg-substep" onSubmit={savePolicy} data-testid="form-policy">
        <div className="pg-substep__head">
          <span className="ds-label">3a · Register yourself as an agent</span>
          {mine?.policy.active ? <Badge tone="ok">Active · {decodeBytes32(mine.policy.role)}</Badge> : <Badge tone="neutral">Not yet</Badge>}
        </div>
        <p className="field__hint">In the playground you play both roles: owner of the vault and its agent. In production the agent is a separate key.</p>
        <div className="ds-form__row">
          <Field label="Per-tx cap"><input className="ds-input" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} name="perTx" /></Field>
          <Field label="Daily cap"><input className="ds-input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} name="daily" /></Field>
          <Field label="Approval above"><input className="ds-input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} name="threshold" /></Field>
          <Field label="Role"><input className="ds-input" maxLength={32} value={role} onChange={(e) => setRole(e.target.value)} name="role" /></Field>
        </div>
        <Button type="submit" className="ds-button--small" disabled={policyTx.busy} data-testid="save-policy">{mine?.policy.active ? "Update policy" : "Register agent"}</Button>
        <TxStatusLine state={policyTx.state} />
      </form>

      <form className="ds-form pg-substep" onSubmit={allow} data-testid="form-allow">
        <div className="pg-substep__head">
          <span className="ds-label">3b · Allowlist a recipient (the data vendor)</span>
          {vendorAllowed ? <Badge tone="ok">Allowlisted</Badge> : <Badge tone="neutral">Not yet</Badge>}
        </div>
        <Field label="Recipient" hint="A random address by default (no known key). Change it to any address you like.">
          <input className="ds-input" value={vendor} onChange={(e) => setVendor(e.target.value)} name="vendor" />
        </Field>
        <Button type="submit" className="ds-button--small" disabled={allowTx.busy || !mine} data-testid="allow-vendor">Allowlist</Button>
        <TxStatusLine state={allowTx.state} />
      </form>

      <form className="ds-form pg-substep" onSubmit={openTask} data-testid="form-open-task">
        <div className="pg-substep__head">
          <span className="ds-label">3c · Open a task (reserve a budget)</span>
          {myTask ? <Badge tone="ok">Open · {formatAmount(myTask.remaining, 6)} left</Badge> : <Badge tone="neutral">Not yet</Badge>}
        </div>
        <div className="ds-form__row">
          <Field label="Budget (mUSDG)" hint={`free in vault: ${formatAmount(d.freeBalance, 6)}`}><input className="ds-input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} name="budget" /></Field>
          <Field label="Duration (days)"><input className="ds-input" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} name="days" /></Field>
        </div>
        <Button type="submit" className="ds-button--small" disabled={taskTx.busy || !mine?.policy.active} data-testid="open-task">Open task</Button>
        <TxStatusLine state={taskTx.state} />
      </form>
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- my vault live state (beside the scenarios)

function MyVaultState({ ctx, myTask }: { ctx: VaultCtx; myTask: VaultData["tasks"][number] | undefined }) {
  const { d } = ctx;
  const mine = d.agents.find((a) => a.address === ctx.account);
  return (
    <div className="pg-state" data-testid="my-vault-state">
      <Card title="My vault" aside={d.paused ? <Badge tone="blocked">Paused</Badge> : <Badge tone="ok">Live</Badge>}>
        <div className="pg-state__grid">
          <div><div className="ds-label">Balance</div><div className="pg-big"><Amount raw={d.balance} d={d} /></div></div>
          <div><div className="ds-label">Free</div><div className="pg-big"><Amount raw={d.freeBalance} d={d} /></div></div>
          <div><div className="ds-label">Reserved</div><div className="pg-big"><Amount raw={d.totalReserved} d={d} /></div></div>
        </div>
      </Card>
      {mine && (
        <Card title="My agent policy" aside={mine.policy.active ? <Badge tone="ok">Active</Badge> : <Badge tone="blocked">Revoked</Badge>}>
          <dl className="ds-kv">
            <dt>Per-tx cap</dt><dd><Amount raw={mine.policy.perTxCap} d={d} /></dd>
            <dt>Daily cap</dt><dd><Amount raw={mine.policy.dailyCap} d={d} /></dd>
            <dt>Approval above</dt><dd><Amount raw={mine.policy.approvalThreshold} d={d} /></dd>
            <dt>Left today</dt><dd className="ds-data"><Amount raw={mine.allowance} d={d} /></dd>
          </dl>
        </Card>
      )}
      {myTask && (
        <Card title="Task budget">
          <dl className="ds-kv">
            <dt>Remaining</dt><dd className="ds-data"><Amount raw={myTask.remaining} d={d} /></dd>
            <dt>Spent</dt><dd><Amount raw={myTask.spent} d={d} /></dd>
            <dt>Time left</dt><dd>{formatCountdown(Number(myTask.expiry) - Number(d.chainTime))}</dd>
          </dl>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page

function VaultArea({ d, refresh, addrs, updateAddrs }: {
  d: VaultData;
  refresh: () => void;
  addrs: DemoAddresses;
  updateAddrs: (p: Partial<DemoAddresses>) => void;
}) {
  const ctx = useVaultCtx(d, refresh);
  const me = ctx.account;
  const mine = d.agents.find((a) => a.address === me);
  const now = Number(d.chainTime);
  const myTask = useMemo(
    () => [...d.tasks].reverse().find((t) => t.open && t.agent === me && Number(t.expiry) > now && t.remaining > 0n),
    [d.tasks, me, now],
  );
  const vendorAllowed = !!mine?.recipients.includes(addrs.vendor) || d.globalRecipients.includes(addrs.vendor) || !d.enforceAllowlist;
  const funded = d.balance > 0n;

  // On first load of a vault (e.g. a returning visitor on another browser, whose locally stored demo
  // addresses are new), adopt a recipient the agent already has allowlisted on-chain as the vendor.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (adopted.current === d.vault || !mine) return;
    adopted.current = d.vault;
    if (!vendorAllowed && mine.recipients.length > 0) updateAddrs({ vendor: mine.recipients[0] });
  }, [d.vault, mine, vendorAllowed, updateAddrs]);
  const setupDone = !!mine?.policy.active && vendorAllowed && !!myTask;

  if (!ctx.isOwner) {
    return <div className="ds-alert ds-alert--error" role="alert">This vault isn't owned by your connected wallet. Pick one of your vaults or create a new one.</div>;
  }
  return (
    <>
      <Step n={3} title="Make yourself an agent" state={!funded ? "locked" : setupDone ? "done" : "current"}>
        <SetupStep ctx={ctx} addrs={addrs} updateAddrs={updateAddrs} myTask={myTask} />
      </Step>
      <Step n={4} title="Run agent scenarios" state={setupDone ? "current" : "locked"}>
        {setupDone && myTask && (
          <div className="pg-split">
            <Scenarios ctx={ctx} task={myTask} addrs={addrs} updateAddrs={updateAddrs} />
            <MyVaultState ctx={ctx} myTask={myTask} />
          </div>
        )}
      </Step>
      {funded && (
        <>
          <section className="ds-stack">
            <SectionTitle title="My vault, live" sub="Everything below is read from the chain" />
            <VaultOverview d={d} />
            <SectionTitle title="Approvals" />
            <Queue ctx={ctx} />
            <SectionTitle title="Escrows" />
            <Escrows ctx={ctx} />
            <SectionTitle title="Activity" />
            <Activity d={d} />
          </section>
        </>
      )}
    </>
  );
}

export default function Playground() {
  const w = useWallet();
  const ready = !!w.account && w.onRightChain;
  const my = useMyVaults(ready ? w.account : null);
  const { data: d, error, refresh } = useVault(ready ? my.selected : null);
  const token = useWalletToken(ready ? w.account : null, my.selected);
  const [addrs, updateAddrs] = useDemoAddresses(my.selected);

  // Keep the remembered vault in sync after creating one.
  const [justCreated, setJustCreated] = useState<Address | null>(null);
  useEffect(() => {
    if (justCreated && my.vaults?.includes(justCreated)) {
      my.select(justCreated);
      setJustCreated(null);
    }
  }, [justCreated, my]);

  const step1: StepState = ready ? "done" : "current";
  const step2: StepState = !ready ? "locked" : d && d.balance > 0n ? "done" : "current";

  return (
    <AppShell
      title="Playground"
      d={d}
      error={error}
      footer={<>Testnet sandbox · {chain.name} · mock token, no real funds · <Link to="/dashboard">demo vault dashboard</Link></>}
    >
      <div className="ds-stack">
        <div className="pg-sandbox" role="note" data-testid="sandbox-label">
          <span className="ds-callout">Testnet sandbox. Mock token. No real funds.</span>
          <span className="pg-sandbox__text">
            Create your own Bursar vault on {chain.name}, give an agent a policy, and watch the contract enforce it. Your wallet signs everything; this site never holds a key.
          </span>
        </div>
        <NetworkBanner />
      </div>

      <section>
        <SectionTitle title="Try it yourself" sub="Four steps, all on-chain, all signed by your wallet" />
        <div className="pg-steps">
          <Step n={1} title="Connect your wallet" state={step1}>
            <WalletStep />
          </Step>
          <Step n={2} title="Create & fund your vault" state={step2}>
            <VaultStep
              my={my}
              d={d}
              token={token}
              refreshVault={refresh}
              onCreated={(v) => {
                setJustCreated(v);
                my.reload();
              }}
            />
          </Step>
          {ready && my.selected && d && addrs && <VaultArea d={d} refresh={refresh} addrs={addrs} updateAddrs={updateAddrs} />}
          {ready && my.selected && !d && !error && <div className="ds-alert"><span className="ds-pulse">Reading your vault…</span></div>}
          {ready && my.selected && error && !d && <div className="ds-alert ds-alert--error" role="alert">Couldn't read your vault: {error}. Retrying.</div>}
        </div>
      </section>
    </AppShell>
  );
}

