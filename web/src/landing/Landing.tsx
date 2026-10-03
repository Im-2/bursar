// Landing page at "/". Built section by section; How it works, Features and FAQ are placeholders for now.
import { useEffect } from "react";
import { SectionTitle } from "../components/ds";
import { Hero } from "./Hero";
import "./landing.css";
import { LandingNav, SECTIONS } from "./LandingNav";

export default function Landing() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Bursar: budgets for AI agents";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="landing-frame">
      <LandingNav />
      <main className="landing-main">
        <Hero />
        {SECTIONS.map((s) => (
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
