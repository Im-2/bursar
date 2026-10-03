// Showcase: big illustration + pitch for the live demo, and a clearly-marked roadmap card.
import { ArrowRight, ExternalLink, FlaskConical, Repeat } from "lucide-react";
import { Link } from "react-router-dom";
import { addressUrl, DEPLOYMENT } from "../lib/chain";
import { ShowcaseScene } from "./ShowcaseScene";

export function Showcase() {
  return (
    <section id="showcase" className="landing-section" aria-labelledby="showcase-title">
      <div className="landing-showcase">
        <div className="ds-card ds-card--canvas landing-showcase__art">
          <ShowcaseScene />
        </div>
        <div className="landing-showcase__text">
          <span className="ds-badge ds-badge--info">See it for yourself</span>
          <h2 className="landing-h2" id="showcase-title">
            Watch an agent spend real testnet money, within limits.
          </h2>
          <p className="landing-showcase__body">
            The demo vault is live on Arbitrum Sepolia. Open the dashboard to see real payments, reasons and blocked
            attempts, or use the playground to try the policy yourself.
          </p>
          <div className="landing-showcase__actions">
            <Link to="/dashboard" className="ds-button landing-cta">
              Open the live dashboard
              <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
            </Link>
            <Link to="/try" className="ds-button ds-button--secondary landing-cta">
              <FlaskConical size={18} strokeWidth={2.5} aria-hidden="true" />
              Try the playground
            </Link>
          </div>
          <a className="landing-textlink" href={addressUrl(DEPLOYMENT.vault)} target="_blank" rel="noopener noreferrer">
            View the contracts on Arbiscan
            <ExternalLink size={14} strokeWidth={2.5} aria-hidden="true" />
            <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        </div>
      </div>

      <div className="landing-roadmap">
        <span className="ds-icon-box landing-roadmap__icon" aria-hidden="true">
          <Repeat size={22} strokeWidth={2.5} />
        </span>
        <div>
          <div className="landing-roadmap__head">
            <span className="ds-badge ds-badge--neutral">Roadmap</span>
            <h3 className="landing-roadmap__title">Coming soon: agent swaps</h3>
          </div>
          <p className="landing-roadmap__text">Let agents rebalance inside the same limits. Not built yet.</p>
        </div>
      </div>
    </section>
  );
}
