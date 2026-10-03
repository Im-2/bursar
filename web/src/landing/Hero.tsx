// Landing hero: live pill, headline with a marker-highlighted word, two calls to action, proof chips,
// and the illustration card with floating note cards.
import { ArrowRight, BadgeCheck, CircleCheck, Coins, ExternalLink, FlaskConical, Gauge, Hourglass, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { stringToHex } from "viem";
import { UseCaseChip } from "../components/ds";
import { addressUrl, DEPLOYMENT } from "../lib/chain";
import { HeroScene } from "./HeroScene";

const EXAMPLE_REASON = "DATA_MARKET_PRICES";

export function Hero() {
  return (
    <section className="landing-hero" aria-labelledby="hero-title">
      <div className="landing-hero__text">
        <span className="landing-pill">
          <span className="landing-pill__dot" aria-hidden="true" />
          Live on Arbitrum Sepolia
        </span>

        <h1 className="landing-hero__title" id="hero-title">
          Give your AI agent a <span className="landing-nowrap"><span className="landing-mark">budget</span>,</span> not your wallet.
        </h1>

        <p className="landing-hero__sub">
          Bursar is an onchain treasury and policy layer for AI agents. Set per-payment and daily limits, approve the
          big spends, and see every payment, with a reason, on-chain.
        </p>

        <div className="landing-hero__actions">
          <Link to="/dashboard" className="ds-button landing-cta">
            Open the live dashboard
            <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
          </Link>
          <Link to="/try" className="ds-button ds-button--secondary landing-cta">
            <FlaskConical size={18} strokeWidth={2.5} aria-hidden="true" />
            Try the agent playground
          </Link>
        </div>

        <ul className="landing-proof" aria-label="Project facts">
          <li>
            <span className="ds-badge ds-badge--ok" title="203 Foundry tests passing, 100% line and branch coverage">
              <CircleCheck size={14} strokeWidth={2.5} aria-hidden="true" />
              203 tests
            </span>
          </li>
          <li>
            <a
              className="ds-badge ds-badge--info landing-proof__link"
              href={addressUrl(DEPLOYMENT.vault)}
              target="_blank"
              rel="noreferrer"
              title="The deployed demo vault's source is verified on Arbiscan"
            >
              <BadgeCheck size={14} strokeWidth={2.5} aria-hidden="true" />
              Verified on Arbiscan
              <ExternalLink size={12} strokeWidth={2.5} aria-hidden="true" />
              <span className="visually-hidden">(opens in a new tab)</span>
            </a>
          </li>
          <li>
            <span
              className="ds-badge ds-badge--pending"
              title="Vaults take any 6-decimal ERC-20 such as USDG. The live demo uses a mock USDG token."
            >
              <Coins size={14} strokeWidth={2.5} aria-hidden="true" />
              Built for USDG
            </span>
          </li>
        </ul>
      </div>

      <figure className="landing-art">
        <div className="ds-card ds-card--canvas landing-art__card">
          <HeroScene />
        </div>
        <div className="landing-notes">
          <div className="landing-note landing-note--mint">
            <div className="landing-note__k">
              <Gauge size={14} strokeWidth={2.5} aria-hidden="true" />
              Per-payment cap
            </div>
            <div className="landing-note__v">25 USDG</div>
          </div>
          <div className="landing-note landing-note--pink">
            <div className="landing-note__k">
              <Hourglass size={14} strokeWidth={2.5} aria-hidden="true" />
              Over the approval threshold?
            </div>
            <div className="landing-note__v">Queued for owner approval</div>
          </div>
          <div className="landing-note landing-note--mustard">
            <div className="landing-note__k">
              <Tag size={14} strokeWidth={2.5} aria-hidden="true" />
              Reason
            </div>
            <div className="landing-note__v">
              <UseCaseChip reason={stringToHex(EXAMPLE_REASON, { size: 32 })} />
            </div>
            <code className="landing-note__code">{EXAMPLE_REASON}</code>
          </div>
        </div>
      </figure>
    </section>
  );
}
