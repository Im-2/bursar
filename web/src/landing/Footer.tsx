// Landing footer: brand, link columns and the testnet / not-audited notice. No signup form (there is no backend).
import { AtSign, BookOpen, FolderGit2, ScrollText, UserRound, Vault, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { addressUrl, DEPLOYMENT } from "../lib/chain";
import { scrollToSection } from "./LandingNav";

const REPO = "https://github.com/Im-2/bursar";

type Ext = { label: string; href: string; icon: LucideIcon };
const RESOURCES: Ext[] = [
  { label: "GitHub repo", href: REPO, icon: FolderGit2 },
  { label: "Contracts on Arbiscan", href: addressUrl(DEPLOYMENT.vault), icon: ScrollText },
  { label: "README", href: `${REPO}#readme`, icon: BookOpen },
];
const CONNECT: Ext[] = [
  { label: "X (@Nuelcrypt)", href: "https://x.com/Nuelcrypt", icon: AtSign },
  { label: "GitHub profile", href: "https://github.com/Im-2", icon: UserRound },
];

function ExtLinks({ links }: { links: Ext[] }) {
  return (
    <ul className="landing-footer__list">
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <li key={l.label}>
            <a href={l.href} target="_blank" rel="noopener noreferrer" className="landing-footer__link">
              <Icon size={16} strokeWidth={2.5} aria-hidden="true" />
              {l.label}
              <span className="visually-hidden">(opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function Footer() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer__card">
        <div className="landing-footer__brand">
          <Link to="/" className="brand" aria-label="Bursar home">
            <span className="brand__logo" aria-hidden="true">
              <Vault size={20} strokeWidth={2.5} />
            </span>
            Bursar
          </Link>
          <p className="landing-footer__tagline">Spending limits for AI agents, on Arbitrum.</p>
          <p className="landing-footer__small">Built for the Arbitrum Open House Singapore buildathon.</p>
        </div>
        <nav className="landing-footer__col" aria-labelledby="footer-product">
          <h2 className="landing-footer__head" id="footer-product">
            Product
          </h2>
          <ul className="landing-footer__list">
            <li>
              <Link to="/dashboard" className="landing-footer__link">Dashboard</Link>
            </li>
            <li>
              <Link to="/try" className="landing-footer__link">Playground</Link>
            </li>
            <li>
              <a href="#how-it-works" className="landing-footer__link" onClick={(e) => scrollToSection(e, "how-it-works")}>
                How it works
              </a>
            </li>
            <li>
              <a href="#features" className="landing-footer__link" onClick={(e) => scrollToSection(e, "features")}>
                Features
              </a>
            </li>
          </ul>
        </nav>
        <nav className="landing-footer__col" aria-labelledby="footer-resources">
          <h2 className="landing-footer__head" id="footer-resources">
            Resources
          </h2>
          <ExtLinks links={RESOURCES} />
        </nav>
        <nav className="landing-footer__col" aria-labelledby="footer-connect">
          <h2 className="landing-footer__head" id="footer-connect">
            Connect
          </h2>
          <ExtLinks links={CONNECT} />
        </nav>
        <p className="landing-footer__bottom">© 2026 Bursar. Testnet only. Not audited.</p>
      </div>
    </footer>
  );
}
