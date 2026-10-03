// Wallet + transaction UI pieces, built on the design-system components.
import { useState, type ReactNode } from "react";
import { chain, txUrl } from "../lib/chain";
import { shortAddr, shortHash } from "../lib/format";
import type { TxState } from "../lib/tx";
import { useWallet } from "../lib/wallet";
import { Badge, Button } from "./ds";

/** Connect / switch-network / connected-account control. */
export function WalletButton({ compact = false }: { compact?: boolean }) {
  const w = useWallet();
  if (!w.hasProvider) {
    return (
      <span className="wallet-note" data-testid="no-wallet">
        No browser wallet found.{" "}
        <a href="https://ethereum.org/en/wallets/find-wallet/" target="_blank" rel="noreferrer">
          Get one
        </a>
      </span>
    );
  }
  if (!w.account) {
    return (
      <Button onClick={w.connect} disabled={w.connecting} data-testid="connect-wallet">
        {w.connecting ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }
  if (!w.onRightChain) {
    return (
      <Button onClick={w.switchChain} data-testid="switch-network">
        Switch to {chain.name}
      </Button>
    );
  }
  return (
    <span className="wallet-account" data-testid="wallet-account" title={w.account}>
      <Badge tone="green">Connected</Badge> {compact ? shortAddr(w.account) : w.account}
    </span>
  );
}

const STATUS_TEXT: Record<TxState["status"], [string, "gray" | "amber" | "green" | "red" | "lime"]> = {
  idle: ["", "gray"],
  simulating: ["Simulating", "gray"],
  signing: ["Confirm in wallet", "amber"],
  pending: ["Pending", "amber"],
  confirmed: ["Confirmed", "green"],
  failed: ["Failed", "red"],
};

/** Inline status line for one action: badge, message, decoded error name, Arbiscan link. */
export function TxStatusLine({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const [text, tone] = STATUS_TEXT[state.status];
  return (
    <div className={`tx-status tx-status--${state.status}`} role="status" aria-live="polite" data-testid="tx-status" data-status={state.status}>
      <Badge tone={tone}>{text}</Badge>
      {state.label && <span className="tx-status__label">{state.label}</span>}
      {state.errorName && (
        <code className="tx-status__error" data-testid="tx-error-name">
          {state.errorName}()
        </code>
      )}
      {state.error && <span className="tx-status__msg">{state.error}</span>}
      {state.hash && (
        <a href={txUrl(state.hash)} target="_blank" rel="noreferrer" data-testid="tx-link">
          tx {shortHash(state.hash)} ↗
        </a>
      )}
    </div>
  );
}

/** Two-step button for destructive actions: first click asks, second click acts. */
export function ConfirmButton({ label, confirmText, onConfirm, disabled, testId }: {
  label: string;
  confirmText: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button className="ds-button--danger" onClick={() => setAsking(true)} disabled={disabled} data-testid={testId}>
        {label}
      </Button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label="Confirm action">
      <span className="confirm__text">{confirmText}</span>
      <Button
        className="ds-button--danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        data-testid={testId ? `${testId}-confirm` : undefined}
        autoFocus
      >
        Yes, {label.toLowerCase()}
      </Button>
      <Button className="ds-button--ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="ds-label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}
