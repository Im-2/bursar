// Landing page at "/". Built section by section; FAQ is a placeholder for now.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SectionTitle } from "../components/ds";
import { Features } from "./Features";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import "./landing.css";
import { LandingNav, SECTIONS } from "./LandingNav";
import { Problem } from "./Problem";
import { Showcase } from "./Showcase";

const PLACEHOLDERS = SECTIONS.filter((s) => s.id === "faq");

export default function Landing() {
  const { hash } = useLocation();

  useEffect(() => {
    const prev = document.title;
    document.title = "Bursar: budgets for AI agents";
    return () => {
      document.title = prev;
    };
  }, []);

  // Opening "/#faq" (etc.) directly lands on that section.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="landing-frame">
      <LandingNav />
      <main className="landing-main">
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <Showcase />
        {PLACEHOLDERS.map((s) => (
          <section key={s.id} id={s.id} className="landing-section" aria-labelledby={`${s.id}-title`}>
            <SectionTitle title={s.label} id={`${s.id}-title`} />
            <div className="empty-state">
              <div className="ds-muted">This section is being built.</div>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
