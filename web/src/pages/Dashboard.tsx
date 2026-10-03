// /dashboard: live view of a vault (the demo vault by default, any vault via ?vault=0x…).
// Panels are read-only for everyone; owner actions appear only for the connected owner.
import { ArrowLeftRight, CirclePause, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Badge, Button, Card, IconBox, SectionTitle, Skeleton } from "../components/ds";
import { OwnerConsole } from "../components/vault/OwnerConsole";
import { SpendChart } from "../components/vault/SpendChart";
import { Activity, Addr, Agents, Escrows, Queue, Tasks, useVaultCtx, VaultOverview, type VaultCtx } from "../components/vault/panels";
import { NetworkBanner, WalletButton } from "../components/web3";
import { addressUrl, chain, DEPLOYMENT, parseAddress, POLL_MS } from "../lib/chain";
import { shortAddr } from "../lib/format";
import { useVault, type VaultData } from "../lib/useVault";
import { useWallet } from "../lib/wallet";
import "./dashboard.css";

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
        {ctx.isApprover ? "As the approver you can release escrows below." : "Connect as owner to manage this vault."}{" "}
        Want your own? <Link to="/try">Create a vault in the playground</Link>.
      </>
    );
  return (
    <section>
      <SectionTitle id="settings" title="Settings" sub="Owner console: policies, tasks, allowlists, pause" aside={<WalletButton />} />
      <div data-testid="owner-console">
        {hint ? <div className="ds-note" data-testid="owner-hint">{hint}</div> : <OwnerConsole ctx={ctx} />}
      </div>
    </section>
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
      <Button className="ds-button--small" type="submit">
        <Search size={15} aria-hidden="true" /> View
      </Button>
      {current !== DEPLOYMENT.vault && (
        <Button className="ds-button--small ds-button--secondary" type="button" onClick={() => { setValue(""); setParams({}); }}>
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
      {d.paused && (
        <div className="paused-banner" role="alert" data-testid="paused-banner">
          <IconBox bg="var(--c-white)">
            <CirclePause size={20} />
          </IconBox>
          <div>
            <strong>This vault is paused.</strong> Agent payments, escrow locks, approvals and releases are frozen until the owner unpauses it.
            Withdrawals, refunds after deadline and closing tasks still work.
          </div>
        </div>
      )}
      <section id="overview" className="overview-anchor">
        <VaultOverview d={d} />
      </section>
      <section>
        <SpendChart d={d} />
      </section>
      <section>
        <SectionTitle id="agents" title="Agents" sub="Policies enforced by the vault contract" />
        <Agents ctx={ctx} />
      </section>
      <section>
        <SectionTitle id="tasks" title="Tasks" sub="Reserved budgets with expiry" />
        <Tasks ctx={ctx} />
      </section>
      <section>
        <SectionTitle id="approvals" title="Approvals" sub="Payments waiting for the owner" />
        <Queue ctx={ctx} />
      </section>
      <section>
        <SectionTitle id="escrows" title="Escrows" sub="Locked until released, or refunded after the deadline" />
        <Escrows ctx={ctx} />
      </section>
      <section>
        <SectionTitle id="activity" title="Activity" sub="Audit trail from the vault's event log" />
        <Activity d={d} />
      </section>
      <section>
        <SectionTitle id="roadmap" title="Roadmap" sub="What's next for Bursar vaults" />
        <div className="ds-grid">
          <Card className="coming-soon" title={<span className="ds-row"><IconBox bg="var(--c-pink)"><ArrowLeftRight size={20} /></IconBox>Swaps and DeFi actions</span>} aside={<Badge tone="pending">Coming soon</Badge>}>
            <p className="ds-muted">
              Let agents swap or put idle funds to work under the same per-tx caps, daily caps, allowlists and approvals. Not built yet: this card is a
              preview only and does nothing.
            </p>
          </Card>
        </div>
      </section>
      <OwnerSection ctx={ctx} />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="overview-grid" aria-busy="true" aria-label="Loading vault">
      <Card tone="mustard">
        <div className="ds-stack">
          <Skeleton height={28} width="45%" />
          <Skeleton height={16} width="60%" />
          <div className="stat-row">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={56} />
            ))}
          </div>
        </div>
      </Card>
      <Card tone="pink">
        <div className="ds-stack">
          <Skeleton height={20} width="50%" />
          <Skeleton height={72} />
        </div>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const [params] = useSearchParams();
  const requested = params.get("vault");
  const vaultAddr = requested ? parseAddress(requested) : DEPLOYMENT.vault;
  const { data, error, loading, refresh } = useVault(vaultAddr);

  return (
    <AppShell
      title={vaultAddr === DEPLOYMENT.vault ? "Demo vault" : "Vault dashboard"}
      d={data}
      error={error}
      loading={!!vaultAddr && !data && !error}
      footer={
        <>
          Every number is read from {chain.name} · refreshes every {POLL_MS / 1000}s · writes are signed in your own wallet ·{" "}
          {vaultAddr && (
            <a href={addressUrl(vaultAddr)} target="_blank" rel="noreferrer">
              vault on Arbiscan
            </a>
          )}
        </>
      }
    >
      <div className="ds-stack">
        <NetworkBanner />
        <VaultPicker current={vaultAddr ?? ""} />
        {!vaultAddr && <div className="ds-alert ds-alert--error" role="alert">That vault address isn't a valid address.</div>}
        {error && (
          <div className="ds-alert ds-alert--error" role="alert">
            {data ? `RPC error: ${error}. Showing the last good data; retrying automatically.` : `Couldn't read this vault: ${error}. Is it a Bursar vault on ${chain.name}? Retrying automatically.`}
          </div>
        )}
      </div>
      {vaultAddr && !data && !error && loading && <LoadingSkeleton />}
      {data && <Body d={data} refresh={refresh} />}
    </AppShell>
  );
}
