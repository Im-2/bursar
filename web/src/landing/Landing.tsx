// Landing page at "/": hero, problem, how it works, features, showcase, FAQ and footer.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Faq } from "./Faq";
import { Features } from "./Features";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import "./landing.css";
import { LandingNav } from "./LandingNav";
import { Problem } from "./Problem";
import { Showcase } from "./Showcase";

export default function Landing() {
  const { hash } = useLocation();

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
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
