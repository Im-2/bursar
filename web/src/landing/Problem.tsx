// "The problem" section: one wide hard-shadow card with the pitch on one side and an illustration on the other.
import { Check } from "lucide-react";
import { ProblemScene } from "./ProblemScene";

const CHECKS = ["Hard on-chain limits", "Owner approval for big spends", "Every payment has a reason"];

export function Problem() {
  return (
    <section id="problem" className="landing-section" aria-labelledby="problem-title">
      <div className="ds-card landing-problem">
        <div className="landing-problem__text">
          <span className="ds-badge ds-badge--blocked">The problem</span>
          <h2 className="landing-h2" id="problem-title">
            Agents can spend money. Nobody can see what they did.
          </h2>
          <p className="landing-problem__body">
            Hand an agent a private key and it can drain the wallet in one bad prompt. Keep it on a leash with manual
            approvals and it can't work on its own. Bursar sits in between: the agent has a budget, the owner has the
            controls.
          </p>
          <ul className="landing-checks" aria-label="What Bursar adds">
            {CHECKS.map((c) => (
              <li key={c} className="ds-badge ds-badge--ok">
                <Check size={14} strokeWidth={3} aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div className="landing-problem__art ds-card--canvas">
          <ProblemScene />
        </div>
      </div>
    </section>
  );
}
