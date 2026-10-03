// Features: three main feature cards plus a strip of the smaller controls. Everything listed exists in the
// deployed BursarVault.
import { CalendarClock, CirclePause, Gauge, Hourglass, ListChecks, LockKeyhole, ScrollText, type LucideIcon } from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; text: string; chip: string; tone: "mint" | "pink" | "mustard" }[] = [
  {
    icon: Gauge,
    title: "Spending limits",
    text: "Per-payment and daily caps enforced by the contract, not by the agent's good behaviour.",
    chip: "Enforced on-chain",
    tone: "mint",
  },
  {
    icon: Hourglass,
    title: "Approval queue",
    text: "Anything above your threshold waits for you. Approve or reject from the dashboard.",
    chip: "Owner in control",
    tone: "pink",
  },
  {
    icon: ScrollText,
    title: "Audit trail with reasons",
    text: "Every payment carries a reason code, shown as plain labels like Bought data/service or Hired a sub-agent. Blocked attempts are logged too.",
    chip: "Readable history",
    tone: "mustard",
  },
];

const EXTRAS: { icon: LucideIcon; label: string }[] = [
  { icon: CalendarClock, label: "Task budgets with expiry" },
  { icon: ListChecks, label: "Recipient allowlists" },
  { icon: LockKeyhole, label: "Escrow for sub-agents and humans" },
  { icon: CirclePause, label: "Pause switch" },
];

export function Features() {
  return (
    <section id="features" className="landing-section" aria-labelledby="features-title">
      <h2 className="landing-h2 landing-h2--center" id="features-title">
        Everything an agent needs to spend safely.
      </h2>
      <ul className="landing-features">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <li key={f.title} className={`ds-card ds-card--${f.tone} landing-feature`}>
              <span className="landing-feature__icon" aria-hidden="true">
                <Icon size={26} strokeWidth={2.25} />
              </span>
              <h3 className="landing-feature__title">{f.title}</h3>
              <p className="landing-feature__text">{f.text}</p>
              <span className="ds-badge ds-badge--neutral landing-feature__chip">{f.chip}</span>
            </li>
          );
        })}
      </ul>
      <ul className="ds-card landing-extras" aria-label="Also built in">
        {EXTRAS.map((x) => {
          const Icon = x.icon;
          return (
            <li key={x.label} className="landing-extras__item">
              <Icon size={18} strokeWidth={2.5} aria-hidden="true" />
              {x.label}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
