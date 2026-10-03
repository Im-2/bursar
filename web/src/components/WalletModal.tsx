// Connect-wallet modal in the Bursar design system (no third-party modal UI).
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import type { Connector } from "wagmi";
import { useWallet, useWalletOptions, WALLETCONNECT_PROJECT_ID } from "../lib/wallet";
import { Badge, Button } from "./ds";

function WalletIcon({ connector }: { connector: Connector }) {
  if (connector.icon) return <img src={connector.icon} alt="" className="wallet-option__icon" width={32} height={32} />;
  return (
    <span className="wallet-option__icon wallet-option__icon--fallback" aria-hidden="true">
      {connector.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function WalletOption({ connector, note, onPick, busy }: { connector: Connector; note?: string; onPick: () => void; busy: boolean }) {
  return (
    <button type="button" className="wallet-option" onClick={onPick} disabled={busy} data-testid={`wallet-option-${connector.id}`}>
      <WalletIcon connector={connector} />
      <span className="wallet-option__name">{connector.name}</span>
      {note && <span className="wallet-option__note">{note}</span>}
    </button>
  );
}

function WalletConnectPanel({ connector }: { connector: Connector }) {
  const w = useWallet();
  const [uri, setUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
      if (type === "display_uri" && typeof data === "string") setUri(data);
    };
    connector.emitter.on("message", onMessage);
    w.connectWith(connector); // resolves once the phone approves
    return () => connector.emitter.off("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector]);

  useEffect(() => {
    if (!uri) return;
    QRCode.toDataURL(uri, { margin: 1, width: 280, color: { dark: "#000000", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [uri]);

  return (
    <div className="wc-panel" data-testid="walletconnect-panel">
      {qr ? <img src={qr} alt="WalletConnect QR code" className="wc-panel__qr" width={240} height={240} /> : <div className="wc-panel__qr wc-panel__qr--loading ds-pulse">Preparing QR…</div>}
      <p className="field__hint">Scan with a WalletConnect-compatible wallet on your phone, then approve the connection there.</p>
      {uri && (
        <Button
          className="ds-button--small ds-button--ghost"
          onClick={() => {
            navigator.clipboard?.writeText(uri).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      )}
    </div>
  );
}

export function WalletModal() {
  const w = useWallet();
  const opts = useWalletOptions();
  const [wcOpen, setWcOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!w.modalOpen) {
      setWcOpen(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && w.closeModal();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [w.modalOpen, w]);

  if (!w.modalOpen) return null;
  const noBrowserWallet = opts.browser.length === 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && w.closeModal()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title" ref={dialogRef} data-testid="wallet-modal">
        <div className="modal__bar">
          <h2 id="wallet-modal-title" className="modal__title">Connect a wallet</h2>
          <button type="button" className="modal__close" onClick={w.closeModal} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <p className="modal__lead">
            Bursar never sees your keys. You sign every transaction in your own wallet, on Arbitrum Sepolia (testnet).
          </p>

          {w.error && (
            <div className="ds-alert ds-alert--error modal__error" role="alert" data-testid="wallet-error">
              {w.error}
            </div>
          )}

          <div className="ds-label modal__section">
            Browser wallets {opts.browser.length > 0 && <Badge tone="green">{opts.browser.length} detected</Badge>}
          </div>
          {noBrowserWallet ? (
            <p className="dash-muted">No browser wallet detected in this browser.</p>
          ) : (
            <div className="wallet-list" data-testid="wallet-list">
              {opts.browser.map((c) => (
                <WalletOption
                  key={c.uid}
                  connector={c}
                  note={c.id === "injected" ? "browser wallet" : "installed"}
                  busy={w.connecting}
                  onPick={() => w.connectWith(c)}
                />
              ))}
            </div>
          )}

          <div className="ds-label modal__section">Other options</div>
          <div className="wallet-list">
            {opts.walletConnect ? (
              <button
                type="button"
                className="wallet-option"
                onClick={() => setWcOpen(true)}
                disabled={w.connecting && !wcOpen}
                data-testid="wallet-option-walletconnect"
                aria-expanded={wcOpen}
              >
                <span className="wallet-option__icon wallet-option__icon--fallback" aria-hidden="true">WC</span>
                <span className="wallet-option__name">WalletConnect</span>
                <span className="wallet-option__note">mobile &amp; other wallets</span>
              </button>
            ) : (
              !WALLETCONNECT_PROJECT_ID && <p className="dash-muted">WalletConnect is not configured for this deployment.</p>
            )}
            {opts.coinbase && (
              <WalletOption connector={opts.coinbase} note="extension or smart wallet" busy={w.connecting} onPick={() => w.connectWith(opts.coinbase!)} />
            )}
          </div>
          {wcOpen && opts.walletConnect && <WalletConnectPanel connector={opts.walletConnect} />}

          {noBrowserWallet && (
            <div className="install-wallet" data-testid="install-wallet">
              <div className="ds-label">Install a wallet</div>
              <p className="dash-muted">Add a browser extension, then reload this page.</p>
              <div className="ds-actions">
                <a className="ds-button ds-button--small" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  MetaMask ↗
                </a>
                <a className="ds-button ds-button--small" href="https://rabby.io/" target="_blank" rel="noreferrer">
                  Rabby ↗
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
