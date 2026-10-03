// Original side illustration for "The problem": the same agent robot holding a raw private key (warning)
// versus holding a small pouch with a spending limit on its tag (check). Same style as the hero scene.

function Robot({ x, y, happy }: { x: number; y: number; happy: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M50 10 V22" />
      <circle cx={50} cy={6} r={6} className="f-pink" strokeWidth={3} />
      <rect x={2} y={84} width={14} height={42} rx={7} className="f-white" strokeWidth={3} />
      <rect x={28} y={140} width={14} height={22} className="f-white" strokeWidth={3} />
      <rect x={58} y={140} width={14} height={22} className="f-white" strokeWidth={3} />
      <rect x={22} y={158} width={24} height={13} rx={4} className="f-ink" strokeWidth={0} />
      <rect x={54} y={158} width={24} height={13} rx={4} className="f-ink" strokeWidth={0} />
      <rect x={18} y={22} width={64} height={48} rx={10} className="f-white" />
      <rect x={28} y={32} width={44} height={28} rx={6} className="f-sky" strokeWidth={3} />
      <circle cx={41} cy={44} r={4} className="f-ink" strokeWidth={0} />
      <circle cx={59} cy={44} r={4} className="f-ink" strokeWidth={0} />
      <path d={happy ? "M42 51 Q50 57 58 51" : "M42 55 Q50 49 58 55"} className="f-none" strokeWidth={3} />
      <rect x={42} y={70} width={16} height={8} className="f-white" strokeWidth={3} />
      <rect x={14} y={76} width={72} height={66} rx={10} className="f-mint" />
      <rect x={28} y={92} width={44} height={20} rx={4} className="f-white" strokeWidth={3} />
      <rect x={84} y={88} width={40} height={16} rx={8} className="f-white" strokeWidth={3} />
      <circle cx={128} cy={96} r={9} className="f-white" strokeWidth={3} />
    </g>
  );
}

export function ProblemScene() {
  return (
    <svg className="scene" viewBox="0 0 520 320" role="img" aria-labelledby="problem-scene-title problem-scene-desc">
      <title id="problem-scene-title">Raw key versus a budget</title>
      <desc id="problem-scene-desc">
        On the left, an agent robot holds a raw private key under a red warning sign. On the right, the same robot holds
        a small pouch whose tag shows a 25 per day limit, with a green check mark.
      </desc>

      {/* panels */}
      <rect x={8} y={8} width={244} height={304} rx={12} className="f-white" strokeWidth={3} />
      <rect x={268} y={8} width={244} height={304} rx={12} className="f-white" strokeWidth={3} />
      <path d="M24 262 H236 M284 262 H496" strokeWidth={3} />

      {/* left: raw key + warning */}
      <Robot x={24} y={92} happy={false} />
      <g>
        <circle cx={172} cy={186} r={17} className="f-mustard" strokeWidth={3} />
        <circle cx={172} cy={186} r={6} className="f-white" strokeWidth={3} />
        <rect x={188} y={181} width={48} height={10} rx={3} className="f-mustard" strokeWidth={3} />
        <rect x={216} y={190} width={7} height={12} className="f-mustard" strokeWidth={3} />
        <rect x={228} y={190} width={7} height={9} className="f-mustard" strokeWidth={3} />
      </g>
      <path d="M190 44 L226 106 L154 106 Z" className="f-blocked" />
      <text x={190} y={98} textAnchor="middle" fontSize={40}>
        !
      </text>
      <text x={130} y={296} textAnchor="middle" fontSize={15}>
        RAW KEY
      </text>

      {/* right: pouch with a limit tag + check */}
      <Robot x={284} y={92} happy />
      <g>
        <path d="M418 196 C402 226 412 250 442 250 C472 250 482 226 466 196 Z" className="f-mustard" strokeWidth={3} />
        <rect x={424} y={186} width={36} height={12} rx={4} className="f-pink" strokeWidth={3} />
        <path d="M430 186 L424 174 M442 186 V172 M454 186 L460 174" strokeWidth={3} />
        <text x={442} y={232} textAnchor="middle" fontSize={20}>
          $
        </text>
        <path d="M460 192 L474 160" strokeWidth={2} />
        <rect x={446} y={130} width={58} height={30} rx={5} className="f-white" strokeWidth={3} />
        <text x={475} y={150} textAnchor="middle" fontSize={12}>
          25/day
        </text>
      </g>
      <circle cx={458} cy={66} r={22} className="f-ok" strokeWidth={3} />
      <path d="M447 67 L455 75 L470 58" className="f-none" strokeWidth={5} />
      <text x={390} y={296} textAnchor="middle" fontSize={15}>
        BUDGET
      </text>

      {/* versus */}
      <circle cx={260} cy={160} r={22} className="f-mustard" strokeWidth={3} />
      <text x={260} y={165} textAnchor="middle" fontSize={14}>
        VS
      </text>
    </svg>
  );
}
