// Original hero illustration, drawn in the design-system palette: an agent robot hands a coin to the vault,
// one coin travels on to a vendor (paid), another bounces off the vault (blocked). Flat fills, thick
// outlines, no gradients. Colours come from CSS classes in landing.css; motion is CSS-only and is
// switched off under prefers-reduced-motion.

function Coin({ r = 16 }: { r?: number }) {
  return (
    <>
      <circle r={r} className="f-mustard" />
      <circle r={r * 0.62} className="f-none" strokeWidth={3} />
      <text y={r * 0.34} textAnchor="middle" fontSize={r * 0.95}>
        $
      </text>
    </>
  );
}

export function HeroScene() {
  // Dial spokes at 0/60/120 degrees through the dial centre.
  const spokes = [0, 60, 120].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a) * 30;
    const dy = Math.sin(a) * 30;
    return { x1: 490 - dx, y1: 218 - dy, x2: 490 + dx, y2: 218 + dy };
  });
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    return { x1: 490 + Math.cos(a) * 46, y1: 218 + Math.sin(a) * 46, x2: 490 + Math.cos(a) * 54, y2: 218 + Math.sin(a) * 54 };
  });
  const awning = Array.from({ length: 6 }, (_, i) => i);

  return (
    <svg className="scene" viewBox="0 0 960 440" role="img" aria-labelledby="scene-title scene-desc">
      <title id="scene-title">An AI agent paying through a Bursar vault</title>
      <desc id="scene-desc">
        A robot agent holds out a coin to a vault. The vault shows a daily limit gauge at 40 of 100 USDG used today.
        One coin travels along a dashed path to a vendor shop and gets a check mark. Another coin bounces off the
        vault under a pink BLOCKED stamp because it is over the limit.
      </desc>

      {/* sparkles */}
      <g className="f-none" strokeWidth={3}>
        <path d="M46 70 v20 M36 80 h20" />
        <path d="M640 52 v16 M632 60 h16" />
        <path d="M900 300 v14 M893 307 h14" />
      </g>
      <circle cx={600} cy={70} r={6} className="f-pink" strokeWidth={3} />
      <circle cx={250} cy={300} r={5} className="f-sky" strokeWidth={3} />

      {/* ground */}
      <path d="M24 400 H936" />

      {/* ---------------------------------------------------------------- robot agent */}
      <g>
        <path d="M150 62 V84" />
        <circle cx={150} cy={54} r={10} className="f-pink" />
        <rect x={90} y={110} width={12} height={26} rx={4} className="f-mustard" />
        <rect x={198} y={110} width={12} height={26} rx={4} className="f-mustard" />
        <rect x={100} y={84} width={100} height={76} rx={14} className="f-white" />
        <rect x={114} y={98} width={72} height={46} rx={8} className="f-sky" />
        <circle cx={136} cy={118} r={6} className="f-ink" strokeWidth={0} />
        <circle cx={164} cy={118} r={6} className="f-ink" strokeWidth={0} />
        <path d="M138 131 Q150 140 162 131" className="f-none" strokeWidth={3} />
        <rect x={138} y={160} width={24} height={12} className="f-white" />
        {/* left arm */}
        <rect x={62} y={186} width={26} height={72} rx={11} className="f-white" />
        <circle cx={75} cy={266} r={12} className="f-white" />
        {/* legs + feet */}
        <rect x={110} y={286} width={28} height={88} rx={8} className="f-white" />
        <rect x={162} y={286} width={28} height={88} rx={8} className="f-white" />
        <rect x={100} y={370} width={46} height={30} rx={8} className="f-ink" />
        <rect x={154} y={370} width={46} height={30} rx={8} className="f-ink" />
        {/* body */}
        <rect x={88} y={172} width={124} height={120} rx={14} className="f-mint" />
        <rect x={110} y={192} width={80} height={46} rx={6} className="f-white" />
        <text x={150} y={221} textAnchor="middle" fontSize={15}>
          AGENT
        </text>
        <rect x={112} y={250} width={18} height={18} rx={4} className="f-ok" strokeWidth={3} />
        <rect x={141} y={250} width={18} height={18} rx={4} className="f-pending" strokeWidth={3} />
        <rect x={170} y={250} width={18} height={18} rx={4} className="f-pink" strokeWidth={3} />
        {/* right arm, held out */}
        <rect x={204} y={190} width={70} height={26} rx={11} className="f-white" />
        <circle cx={280} cy={203} r={14} className="f-white" />
        <g transform="translate(298 178)">
          <Coin r={22} />
        </g>
      </g>

      {/* ---------------------------------------------------------------- vault */}
      <g>
        <rect x={386} y={380} width={40} height={20} rx={4} className="f-ink" />
        <rect x={554} y={380} width={40} height={20} rx={4} className="f-ink" />
        <rect x={360} y={110} width={260} height={276} rx={18} className="f-sky" />
        <text x={490} y={128} textAnchor="middle" fontSize={14} letterSpacing={3}>
          BURSAR
        </text>
        <rect x={384} y={134} width={212} height={228} rx={12} className="f-white" />
        <rect x={372} y={160} width={18} height={34} rx={4} className="f-mustard" strokeWidth={3} />
        <rect x={372} y={300} width={18} height={34} rx={4} className="f-mustard" strokeWidth={3} />
        {/* dial */}
        <circle cx={490} cy={218} r={58} className="f-mustard" />
        {ticks.map((t, i) => (
          <line key={i} {...t} strokeWidth={3} />
        ))}
        <circle cx={490} cy={218} r={40} className="f-white" />
        {spokes.map((s, i) => (
          <line key={i} {...s} strokeWidth={6} />
        ))}
        <circle cx={490} cy={218} r={11} className="f-pink" strokeWidth={4} />
        {/* daily limit gauge */}
        <text x={404} y={304} fontSize={13}>
          DAILY LIMIT
        </text>
        <rect x={404} y={312} width={69} height={22} rx={6} className="f-ok" strokeWidth={0} />
        <path d="M473 312 V334" strokeWidth={3} />
        <rect x={404} y={312} width={172} height={22} rx={6} className="f-none" strokeWidth={3} />
        <text x={490} y={354} textAnchor="middle" fontSize={14}>
          40 / 100 USDG today
        </text>
      </g>

      {/* ---------------------------------------------------------------- paid: vault -> vendor */}
      <path d="M624 190 Q700 90 770 176" className="f-none scene__path" strokeWidth={4} strokeDasharray="2 12" />
      <path d="M758 160 L772 178 L750 182" className="f-none" strokeWidth={4} />
      <g className="scene__travel" transform="translate(698 136)">
        <Coin />
      </g>

      {/* ---------------------------------------------------------------- vendor storefront */}
      <g>
        <rect x={780} y={236} width={150} height={164} className="f-white" />
        <rect x={796} y={258} width={56} height={52} rx={4} className="f-sky" />
        <path d="M824 258 V310 M796 284 H852" strokeWidth={3} />
        <rect x={866} y={272} width={48} height={128} rx={4} className="f-mint" />
        <circle cx={904} cy={340} r={4} className="f-ink" strokeWidth={0} />
        {awning.map((i) => (
          <rect key={i} x={768 + i * 29} y={204} width={29} height={34} className={i % 2 ? "f-white" : "f-pink"} strokeWidth={3} />
        ))}
        <path d="M768 238 H942" />
        <rect x={792} y={164} width={124} height={32} rx={6} className="f-mustard" />
        <text x={854} y={186} textAnchor="middle" fontSize={15}>
          VENDOR
        </text>
        <circle cx={924} cy={150} r={22} className="f-ok" />
        <path d="M913 151 L921 159 L936 142" className="f-none" strokeWidth={5} />
      </g>

      {/* ---------------------------------------------------------------- blocked: bounces off the vault */}
      <path d="M352 104 l10 -10 M346 92 l4 -14 M362 112 l14 -4" strokeWidth={3} />
      <path d="M296 70 q-16 -4 -30 -20" className="f-none" strokeWidth={3} strokeDasharray="2 8" />
      <g transform="translate(330 88)">
        <g className="scene__bounce">
          <Coin />
        </g>
      </g>
      <g transform="translate(406 30) rotate(-9)">
        <g className="scene__stamp">
          <rect x={0} y={0} width={150} height={44} rx={6} className="f-pink" />
          <rect x={6} y={6} width={138} height={32} rx={4} className="f-none" strokeWidth={2} strokeDasharray="5 4" />
          <text x={75} y={29} textAnchor="middle" fontSize={20} letterSpacing={2}>
            BLOCKED
          </text>
        </g>
      </g>
    </svg>
  );
}
