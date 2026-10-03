// App frame: mint sidebar (drawer on phones) + top bar + content. Used by /dashboard and /try.
import { Activity, Bot, FlaskConical, Inbox, LayoutDashboard, ListChecks, LockKeyhole, Menu, Settings, Vault, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { chain, POLL_MS } from "../lib/chain";
import { formatAgo } from "../lib/format";
import type { VaultData } from "../lib/useVault";
import { Badge, IconButton } from "./ds";
import { useNow } from "./vault/panels";
import { WalletButton } from "./web3";

export const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "approvals", label: "Approvals", icon: Inbox },
  { id: "escrows", label: "Escrows", icon: LockKeyhole },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "try", label: "Try it", icon: FlaskConical, path: "/try" },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const loc = useLocation();
  const onDashboard = loc.pathname === "/dashboard";
  const activeHash = loc.hash.replace("#", "") || "overview";
  return (
    <nav className="sidebar" data-open={open} aria-label="Main" id="app-sidebar">
      <Link to="/dashboard" className="sidebar__brand" onClick={onNavigate}>
        <span className="sidebar__logo" aria-hidden="true">
          <Vault size={20} strokeWidth={2.5} />
        </span>
        Bursar
      </Link>
      <div className="sidebar__nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isTry = "path" in item;
          const active = isTry ? loc.pathname === "/try" : onDashboard && activeHash === item.id;
          const to = isTry ? "/try" : { pathname: "/dashboard", search: onDashboard ? loc.search : "", hash: `#${item.id}` };
          return (
            <Link
              key={item.id}
              to={to}
              className="sidebar__link"
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              data-testid={`nav-${item.id}`}
            >
              <Icon size={18} strokeWidth={2.25} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="sidebar__foot">
        Testnet · {chain.name}
        <br />
        Your wallet signs every action.
      </div>
    </nav>
  );
}

function TopBar({ title, d, error, onMenu, menuOpen }: { title: string; d: VaultData | null; error: string | null; onMenu: () => void; menuOpen: boolean }) {
  const now = useNow();
  const age = d ? (now - d.fetchedAt) / 1000 : 0;
  const stale = !!d && age > (POLL_MS / 1000) * 3;
  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="topbar__menu">
          <IconButton label={menuOpen ? "Close menu" : "Open menu"} onClick={onMenu} aria-expanded={menuOpen} aria-controls="app-sidebar">
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </IconButton>
        </span>
        <span className="topbar__title">{title}</span>
      </div>
      <div className="topbar__right">
        <Badge tone="info">{chain.name}</Badge>
        {d ? d.paused ? <Badge tone="blocked">Paused</Badge> : <Badge tone="ok">Live</Badge> : <Badge>Connecting</Badge>}
        <span className={`dash-updated ${stale || error ? "dash-updated--stale" : ""}`} aria-live="polite">
          {d ? (
            <>
              Updated {formatAgo(age)} · block {d.blockNumber.toString()}
            </>
          ) : (
            "Loading…"
          )}
        </span>
        <WalletButton compact />
      </div>
    </header>
  );
}

export function AppShell({ title, d, error, children, footer }: {
  title: string;
  d: VaultData | null;
  error: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  // Scroll to #section on navigation (react-router doesn't do hash scrolling).
  useEffect(() => {
    const id = loc.hash.replace("#", "");
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return () => clearTimeout(t);
  }, [loc.hash, loc.pathname, d === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-frame">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      <div className="drawer-backdrop" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="app-main">
        <TopBar title={title} d={d} error={error} onMenu={() => setOpen((o) => !o)} menuOpen={open} />
        <main className="app-content">{children}</main>
        {footer && <footer className="app-footer">{footer}</footer>}
      </div>
    </div>
  );
}
