// "How it works": three numbered step cards and a link to the live dashboard.
import { ArrowRight, Bot, SlidersHorizontal, Vault, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

const STEPS: { title: string; text: string; icon: LucideIcon; tone: "mint" | "pink" | "canvas" }[] = [
  {
    title: "Fund a vault",
    text: "Create a vault from the factory and deposit USDG. You stay the owner.",
    icon: Vault,
    tone: "mint",
  },
  {
    title: "Set the policy",
    text: "Per-payment cap, daily cap, approval threshold, allowed recipients and a task budget with an expiry.",
    icon: SlidersHorizontal,
    tone: "pink",
  },
  {
    title: "Let the agent work",
    text: "The agent pays within limits. Over the threshold it waits for your approval. Over a cap it's blocked, and the attempt is logged on-chain.",
    icon: Bot,
    tone: "canvas",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="landing-section" aria-labelledby="how-title">
      <h2 className="landing-h2 landing-h2--center" id="how-title">
        Three steps. No trust required.
      </h2>
      <ol className="landing-steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className={`ds-card ds-card--${s.tone} landing-step`}>
              <span className="landing-step__num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="landing-step__body">
                <h3 className="landing-step__title">
                  <span className="visually-hidden">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="landing-step__text">{s.text}</p>
              </div>
              <span className="landing-step__icon" aria-hidden="true">
                <Icon size={28} strokeWidth={2.25} />
              </span>
            </li>
          );
        })}
      </ol>
      <div className="landing-center">
        <Link to="/dashboard" className="ds-button landing-cta">
          See it live on the dashboard
          <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
