// Landing top nav: wordmark, in-page section links (smooth scroll), and links into the app.
// Below 900px the links and buttons collapse into a menu button.
import { FlaskConical, LayoutDashboard, Menu, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../components/ds";

export const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "faq", label: "FAQ" },
] as const;

/** Scrolls to a section without a router navigation; respects reduced motion. */
export function scrollToSection(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

export function LandingNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const links = SECTIONS.map((s) => (
    <a
      key={s.id}
      href={`#${s.id}`}
      className="landing-nav__link"
      onClick={(e) => {
        setOpen(false);
        scrollToSection(e, s.id);
      }}
    >
      {s.label}
    </a>
  ));

  return (
    <header className="landing-nav">
      <Link to="/" className="brand" aria-label="Bursar home">
        <BrandMark size={40} />
        Bursar
      </Link>

      <nav className="landing-nav__links" aria-label="Page sections">
        {links}
      </nav>

      <div className="landing-nav__actions">
        <Link to="/try" className="ds-button ds-button--secondary ds-button--small">
          <FlaskConical size={14} strokeWidth={2.5} aria-hidden="true" />
          Try it
        </Link>
        <Link to="/dashboard" className="ds-button">
          <LayoutDashboard size={16} strokeWidth={2.5} aria-hidden="true" />
          Open dashboard
        </Link>
      </div>

      <button
        type="button"
        className="ds-icon-button landing-nav__menu"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="landing-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={18} strokeWidth={2.5} /> : <Menu size={18} strokeWidth={2.5} />}
      </button>

      <div className="landing-nav__panel" id="landing-menu" data-open={open} hidden={!open}>
        <nav className="landing-nav__panel-links" aria-label="Page sections (menu)">
          {links}
        </nav>
        <div className="landing-nav__panel-actions">
          <Link to="/dashboard" className="ds-button">
            <LayoutDashboard size={16} strokeWidth={2.5} aria-hidden="true" />
            Open dashboard
          </Link>
          <Link to="/try" className="ds-button ds-button--secondary">
            <FlaskConical size={16} strokeWidth={2.5} aria-hidden="true" />
            Try it
          </Link>
        </div>
      </div>
    </header>
  );
}
