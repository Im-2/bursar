// /dashboard: live view of a vault (the demo vault by default, any vault via ?vault=0x…).
// Stage A panels are read-only for everyone; Stage B owner actions appear only for the connected owner.
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, SectionBar } from "../components/ds";
import { OwnerConsole } from "../components/vault/OwnerConsole";
import { Activity, Addr, Agents, Escrows, Queue, Tasks, useNow, useVaultCtx, VaultOverview, type VaultCtx } from "../components/vault/panels";
import { NetworkBanner, WalletButton } from "../components/web3";
import { addressUrl, chain, DEPLOYMENT, parseAddress, POLL_MS } from "../lib/chain";
import { formatAgo, shortAddr } from "../lib/format";
import { useVault, type VaultData } from "../lib/useVault";
import { useWallet } from "../lib/wallet";
import "./dashboard.css";

export function SiteHeader({ d, error, title }: { d: VaultData | null; error: string | null; title: string }) {
  const now = useNow();
  const age = d ? (now - d.fetchedAt) / 1000 : 0;
  const stale = d && age > (POLL_MS / 1000) * 3;
  return (
    <header className="dash-header">
      <div className="dash-header__inner">
        <div className="dash-header__left">
          <Link to="/dashboard" className="dash-header__brand">BURSAR</Link>
          <div className="dash-header__sub">{title}</div>
        </div>
        <nav className="dash-nav" aria-label="Main">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/try">Playground</Link>
        </nav>
        <div className="dash-header__meta">
          <Badge tone="black">{chain.name}</Badge>
          {d ? d.paused ? <Badge tone="red">Paused</Badge> : <Badge tone="green">Live</Badge> : <Badge tone="gray">Connecting</Badge>}
          <span className={`dash-updated ${stale || error ? "dash-updated--stale" : ""}`} aria-live="polite">
            {d ? (
              <>
                <span className={stale || error ? "" : "ds-pulse"}>●</span> updated {formatAgo(age)} · block {d.blockNumber.toString()}
              </>
            ) : (
              "loading…"
            )}
          </span>
          <WalletButton compact />
        </div>
      </div>
    </header>
  );
}

function OwnerSection({ ctx }: { ctx: VaultCtx }) {
  const w = useWallet();
  const { d } = ctx;
  let hint: React.ReactNode = null;
  if (!w.account) hint = <>Read-only. <strong>Connect as owner</strong> ({shortAddr(d.owner)}) to approve requests, release escrows, open tasks and change policy.</>;
  else if (!w.onRightChain) hint = <>Your wallet is on another network. Switch to {chain.name} to continue.</>;
  else if (!ctx.isOwner)
    hint = (
      <>
        Read-only. You're connected as {shortAddr(w.account)}, but the owner is <Addr a={d.owner} />.{" "}
        {ctx.isApprover ? "As the approver you can release escrows below." : "Connect as owner to manage this vault."}
        {" "}Want your own? <Link to="/try">Create a vault in the playground</Link>.
      </>
    );
  return (
    <>
      <SectionBar eyebrow="Owner only" title="Owner console" aside={<WalletButton />} />
      <div className="ds-container" data-testid="owner-console">
        {hint ? <div className="ds-note" data-testid="owner-hint">{hint}</div> : <OwnerConsole ctx={ctx} />}
      </div>
    </>
  );
}

function VaultPicker({ current }: { current: string }) {
  const [, setParams] = useSearchParams();
  const [value, setValue] = useState(current === DEPLOYMENT.vault ? "" : current);
  const [err, setErr] = useState<string | null>(null);
  function go(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return setParams({});
    const a = parseAddress(value);
    if (!a) return setErr("Not a valid address.");
    setErr(null);
    setParams({ vault: a });
  }
  return (
    <form className="vault-picker" onSubmit={go} aria-label="View another vault">
      <input className="ds-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="View another vault: 0x…" aria-label="Vault address" />
      <Button className="ds-button--small" type="submit">View</Button>
      {current !== DEPLOYMENT.vault && (
        <Button className="ds-button--small ds-button--ghost" type="button" onClick={() => { setValue(""); setParams({}); }}>
          Demo vault
        </Button>
      )}
      {err && <span className="form-error">{err}</span>}
    </form>
  );
}

function Body({ d, refresh }: { d: VaultData; refresh: () => void }) {
  const ctx = useVaultCtx(d, refresh);
  return (
    <>
      <div className="ds-container dash-top">
        <VaultOverview d={d} />
      </div>
      <OwnerSection ctx={ctx} />
      <SectionBar eyebrow="Policy enforced onchain" title="Agents" />
      <div className="ds-container">
        <Agents ctx={ctx} />
      </div>
      <SectionBar eyebrow="Reserved budgets" title="Tasks" />
      <div className="ds-container">
        <Tasks ctx={ctx} />
      </div>
      <SectionBar eyebrow="Waiting on a human" title="Approvals & escrow" />
      <div className="ds-container dash-stack">
        <Queue ctx={ctx} />
        <Escrows ctx={ctx} />
      </div>
      <SectionBar eyebrow="Audit trail" title="Activity" />
      <div className="ds-container">
        <Activity d={d} />
      </div>
    </>
  );
}

export default function Dashboard() {
  const [params] = useSearchParams();
  const requested = params.get("vault");
  const vaultAddr = requested ? parseAddress(requested) : DEPLOYMENT.vault;
  const { data, error, loading, refresh } = useVault(vaultAddr);

  return (
    <>
      <SiteHeader d={data} error={error} title={vaultAddr === DEPLOYMENT.vault ? "Demo vault dashboard" : "Vault dashboard"} />
      <main className="dash-main" aria-busy={loading}>
        <div className="ds-container">
          <NetworkBanner />
          <VaultPicker current={vaultAddr ?? ""} />
        </div>
        {!vaultAddr && (
          <div className="ds-container">
            <div className="ds-alert ds-alert--error" role="alert">That vault address isn't a valid address.</div>
          </div>
        )}
        {error && (
          <div className="ds-container">
            <div className="ds-alert ds-alert--error" role="alert">
              {data ? `RPC error: ${error}. Showing the last good data; retrying automatically.` : `Couldn't read this vault: ${error}. Is it a Bursar vault on ${chain.name}? Retrying automatically.`}
            </div>
          </div>
        )}
        {vaultAddr && !data && !error && (
          <div className="ds-container">
            <div className="ds-alert dash-loading">
              <span className="ds-pulse">Reading the vault from {chain.name}…</span>
            </div>
          </div>
        )}
        {data && <Body d={data} refresh={refresh} />}
      </main>
      <footer className="dash-footer">
        <div className="ds-container">
          Every number is read from {chain.name} · refreshes every {POLL_MS / 1000}s · writes are signed in your own wallet ·{" "}
          {vaultAddr && (
            <a href={addressUrl(vaultAddr)} target="_blank" rel="noreferrer">
              vault on Arbiscan
            </a>
          )}
        </div>
      </footer>
    </>
  );
}
