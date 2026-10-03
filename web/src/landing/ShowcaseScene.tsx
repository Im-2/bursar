// Original showcase illustration: an owner dashboard window with three activity rows, and the agent robot
// peeking over the top edge holding a coin. The rows are illustrative; their labels and statuses are real
// Bursar concepts (use-case labels, paid / escrow / awaiting approval).

const ROWS = [
  { label: "Bought data", amount: "4 USDG", status: "Paid", pill: "f-ok", pillW: 52, icon: "f-sky" },
  { label: "Hired a sub-agent", amount: "12 USDG", status: "Escrow", pill: "f-pink", pillW: 70, icon: "f-mint" },
  { label: "Paid a human", amount: "60 USDG", status: "Awaiting approval", pill: "f-mustard", pillW: 136, icon: "f-pink" },
];

function Coin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={17} className="f-mustard" />
      <circle r={10} className="f-none" strokeWidth={3} />
      <text y={6} textAnchor="middle" fontSize={16}>
        $
      </text>
    </g>
  );
}

export function ShowcaseScene() {
  return (
    <svg className="scene" viewBox="0 0 560 410" role="img" aria-labelledby="showcase-scene-title showcase-scene-desc">
      <title id="showcase-scene-title">An owner dashboard with an agent peeking over it</title>
      <desc id="showcase-scene-desc">
        A browser window shows recent agent activity: Bought data, 4 USDG, paid; Hired a sub-agent, 12 USDG, in escrow;
        Paid a human, 60 USDG, awaiting approval. A robot agent peeks over the top of the window holding a coin.
      </desc>

      {/* sparkles */}
      <g className="f-none" strokeWidth={3}>
        <path d="M44 52 v18 M35 61 h18" />
        <path d="M530 210 v14 M523 217 h14" />
      </g>
      <circle cx={300} cy={44} r={6} className="f-pink" strokeWidth={3} />

      {/* robot head, behind the window */}
      <path d="M415 26 V44" />
      <circle cx={415} cy={20} r={8} className="f-pink" strokeWidth={3} />
      <rect x={370} y={44} width={90} height={80} rx={14} className="f-white" />
      <rect x={382} y={56} width={66} height={40} rx={8} className="f-sky" strokeWidth={3} />
      <circle cx={403} cy={74} r={5} className="f-ink" strokeWidth={0} />
      <circle cx={427} cy={74} r={5} className="f-ink" strokeWidth={0} />
      <path d="M405 84 Q415 91 425 84" className="f-none" strokeWidth={3} />

      {/* window */}
      <rect x={40} y={110} width={480} height={282} rx={14} className="f-white" />
      <path d="M54 110 H506 Q520 110 520 124 V150 H40 V124 Q40 110 54 110 Z" className="f-sky" />
      <circle cx={64} cy={130} r={7} className="f-pink" strokeWidth={3} />
      <circle cx={86} cy={130} r={7} className="f-mustard" strokeWidth={3} />
      <circle cx={108} cy={130} r={7} className="f-ok" strokeWidth={3} />
      <rect x={130} y={120} width={200} height={20} rx={6} className="f-white" strokeWidth={3} />
      <text x={142} y={135} fontSize={11}>
        bursar / dashboard
      </text>
      <text x={64} y={184} fontSize={16}>
        Recent activity
      </text>

      {ROWS.map((r, i) => {
        const y = 200 + i * 60;
        return (
          <g key={r.label}>
            <rect x={64} y={y} width={432} height={50} rx={8} className="f-canvas" strokeWidth={3} />
            <rect x={76} y={y + 11} width={28} height={28} rx={6} className={r.icon} strokeWidth={3} />
            <text x={116} y={y + 30} fontSize={13}>
              {r.label}
            </text>
            <text x={278} y={y + 30} fontSize={13}>
              {r.amount}
            </text>
            <rect x={484 - r.pillW} y={y + 13} width={r.pillW} height={24} rx={12} className={r.pill} strokeWidth={3} />
            <text x={484 - r.pillW / 2} y={y + 29} textAnchor="middle" fontSize={11}>
              {r.status}
            </text>
          </g>
        );
      })}

      {/* hands over the window edge, one holding a coin */}
      <circle cx={380} cy={112} r={11} className="f-white" strokeWidth={3} />
      <circle cx={452} cy={112} r={11} className="f-white" strokeWidth={3} />
      <Coin x={470} y={88} />
    </svg>
  );
}
