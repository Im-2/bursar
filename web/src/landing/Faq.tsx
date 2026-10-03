// FAQ: three tabs (WAI-ARIA tabs pattern, roving tabindex, arrow keys) over a one-open-at-a-time accordion.
// Answers are checked against src/BursarVault.sol and the README.
import { ChevronDown } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

type Item = { q: string; a: string };

const TABS: { id: string; label: string; items: Item[] }[] = [
  {
    id: "basics",
    label: "Basics",
    items: [
      {
        q: "What is Bursar?",
        a: "An onchain treasury and policy layer for AI agents. An owner funds a vault, sets spending rules, and an agent can pay only within them.",
      },
      {
        q: "Who holds the money?",
        a: "The vault contract holds the funds. The owner controls it. The agent has no way to withdraw; it can only pay through the policy.",
      },
      {
        q: "What can an agent pay for?",
        a: "Anything the owner allows: data and API access, other agents, or humans, via direct payment or escrow. Payments to recipients outside the allowlist wait for owner approval. Every payment carries a reason code.",
      },
    ],
  },
  {
    id: "safety",
    label: "Safety",
    items: [
      {
        q: "What if the agent tries to overspend?",
        a: "If a payment exceeds the per-payment cap, daily cap or task budget, it's blocked and a PaymentBlocked event is recorded on-chain. Above the approval threshold, it waits in a queue for the owner. An escrow that would break a limit is rejected outright.",
      },
      {
        q: "Can the owner stop everything?",
        a: "Yes. The owner can pause the vault, which stops agent payments, escrows and approvals. The owner can also revoke an agent or change its policy, close tasks, reject queued requests and withdraw any funds not locked in escrow, at any time.",
      },
      {
        q: "Is it audited?",
        a: "No. It's a hackathon project on testnet with 203 tests including fuzz and invariant tests, but it has not had a professional audit. Don't use it with real funds.",
      },
    ],
  },
  {
    id: "build",
    label: "Build",
    items: [
      {
        q: "Which network and token?",
        a: "Arbitrum Sepolia today. The vault works with any standard ERC-20 (not fee-on-transfer or rebasing tokens) and is built for USDG; the live demo uses a test token because we couldn't obtain test USDG.",
      },
      {
        q: "How does an agent connect?",
        a: "Through the contract directly, a TypeScript client, or the MCP server in this repo, which lets a coding agent such as Claude Code call tools like pay and create_escrow.",
      },
      {
        q: "What's coming next?",
        a: "Agent swaps inside the same limits, ERC-4337 session keys for agents, and testing with real USDG. Any address can already own a vault, including a multisig; making that the default is also planned. These are roadmap items, not shipped.",
      },
    ],
  },
];

export function Faq() {
  const [tab, setTab] = useState(0);
  // Open item per tab; the first item of each tab starts open. -1 = all closed.
  const [open, setOpen] = useState<number[]>(() => TABS.map(() => 0));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (i: number) => {
    setTab(i);
    tabRefs.current[i]?.focus();
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = TABS.length;
    const next = { ArrowRight: (tab + 1) % n, ArrowLeft: (tab - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next);
  };
  const toggle = (i: number) => setOpen((o) => o.map((v, t) => (t === tab ? (v === i ? -1 : i) : v)));

  const active = TABS[tab];
  return (
    <section id="faq" className="landing-section" aria-labelledby="faq-title">
      <h2 className="landing-h2 landing-h2--center" id="faq-title">
        Questions, answered.
      </h2>
      <div className="landing-tabs" role="tablist" aria-label="FAQ topics">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`faq-tab-${t.id}`}
            aria-selected={i === tab}
            aria-controls={`faq-panel-${t.id}`}
            tabIndex={i === tab ? 0 : -1}
            className="landing-tab"
            onClick={() => setTab(i)}
            onKeyDown={onTabKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="landing-faq" role="tabpanel" id={`faq-panel-${active.id}`} aria-labelledby={`faq-tab-${active.id}`}>
        {active.items.map((item, i) => {
          const isOpen = open[tab] === i;
          const id = `faq-${active.id}-${i}`;
          return (
            <div key={id} className="landing-faq__item" data-open={isOpen}>
              <h3 className="landing-faq__q">
                <button type="button" id={`${id}-btn`} aria-expanded={isOpen} aria-controls={`${id}-answer`} onClick={() => toggle(i)}>
                  <span>{item.q}</span>
                  <ChevronDown size={20} strokeWidth={2.5} aria-hidden="true" className="landing-faq__chev" />
                </button>
              </h3>
              <div
                className="landing-faq__a"
                id={`${id}-answer`}
                role="region"
                aria-labelledby={`${id}-btn`}
                aria-hidden={!isOpen}
                inert={!isOpen}
              >
                <div className="landing-faq__a-inner">
                  <p>{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
