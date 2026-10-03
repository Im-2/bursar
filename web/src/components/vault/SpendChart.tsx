// Spend over time: stacked daily columns (paid / approved / released) built only from vault events,
// against the agents' combined daily cap. Palette validated with the dataviz validator against the white
// card surface (CVD ΔE ≥ 28); the amber is < 3:1 so every bar is outlined, labelled by a legend, and the
// same numbers are available as a table.
import { useMemo, useState } from "react";
import { formatAmount } from "../../lib/format";
import type { VaultData } from "../../lib/useVault";
import { Button, Card } from "../ds";

const SERIES = [
  { key: "paid", label: "Paid by agent", color: "#1f3fbf", event: "PaymentExecuted" },
  { key: "approved", label: "Approved by owner", color: "#c43fb3", event: "RequestApproved" },
  { key: "released", label: "Escrow released", color: "#e0a100", event: "EscrowReleased" },
] as const;
type Key = (typeof SERIES)[number]["key"];
type Day = { day: number; label: string } & Record<Key, bigint>;

const DAYS = 7;
const W = 640;
const H = 230;
const M = { top: 16, right: 12, bottom: 30, left: 56 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(day: number) {
  const dt = new Date(day * 86400 * 1000);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** A "nice" axis step (1, 2 or 5 x 10^k) giving about `count` intervals up to `max`. */
function niceStep(max: number, count = 4) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

export function SpendChart({ d }: { d: VaultData }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const dec = d.token.decimals;
  const unit = 10 ** dec;

  const { days, cap } = useMemo(() => {
    const today = Math.floor(Number(d.chainTime) / 86400);
    const days: Day[] = Array.from({ length: DAYS }, (_, i) => {
      const day = today - (DAYS - 1 - i);
      return { day, label: dayLabel(day), paid: 0n, approved: 0n, released: 0n };
    });
    for (const e of d.events) {
      const s = SERIES.find((x) => x.event === e.name);
      if (!s || e.amount === undefined) continue;
      const idx = Math.floor(Number(e.timestamp) / 86400) - days[0].day;
      if (idx >= 0 && idx < DAYS) days[idx][s.key] += e.amount;
    }
    const cap = d.agents.filter((a) => a.policy.active).reduce((s, a) => s + a.policy.dailyCap, 0n);
    return { days, cap };
  }, [d.events, d.agents, d.chainTime]);

  const totals = days.map((x) => x.paid + x.approved + x.released);
  const maxRaw = [...totals, cap].reduce((m, v) => (v > m ? v : m), 0n);
  const step = niceStep(Math.max(Number(maxRaw) / unit, 1));
  const max = Math.ceil((Math.max(Number(maxRaw) / unit, 1) * 1.08) / step) * step;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const colW = plotW / DAYS;
  const barW = Math.min(44, colW * 0.56);
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const capY = y(Number(cap) / unit);
  const fmt = (v: bigint) => formatAmount(v, dec);

  return (
    <Card title="Spend over time" aside={<Button className="ds-button--small ds-button--secondary" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>{showTable ? "Show chart" : "Show table"}</Button>}>
      <ul className="chart-legend" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className="chart-legend__swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
        <li>
          <span className="chart-legend__line" aria-hidden="true" />
          Daily cap (autonomous spend, all agents)
        </li>
      </ul>

      {showTable ? (
        <table className="chart-table">
          <caption className="visually-hidden">Outflows per UTC day, {d.token.symbol}</caption>
          <thead>
            <tr>
              <th scope="col">Day (UTC)</th>
              {SERIES.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {days.map((x, i) => (
              <tr key={x.day}>
                <th scope="row">{x.label}</th>
                {SERIES.map((s) => <td key={s.key}>{fmt(x[s.key])}</td>)}
                <td><strong>{fmt(totals[i])}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="spend-chart" role="img" aria-label={`Outflows per day for the last ${DAYS} days against a daily cap of ${fmt(cap)} ${d.token.symbol}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="spend-chart__grid" />
                <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="spend-chart__tick">{t.toLocaleString("en-US")}</text>
              </g>
            ))}
            {days.map((x, i) => {
              const cx = M.left + colW * i + colW / 2;
              let base = M.top + plotH;
              const segs = SERIES.filter((s) => x[s.key] > 0n);
              return (
                <g key={x.day}>
                  {segs.map((s, j) => {
                    const h = (Number(x[s.key]) / unit / max) * plotH;
                    const top = base - h;
                    const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
                    const rect = <rect key={s.key} x={cx - barW / 2} y={top} width={barW} height={Math.max(h - gap, 1)} fill={s.color} className="spend-chart__bar" rx={j === segs.length - 1 ? 3 : 0} />;
                    base = top;
                    return rect;
                  })}
                  <text x={cx} y={H - 10} textAnchor="middle" className="spend-chart__tick">{x.label}</text>
                  <rect
                    x={M.left + colW * i}
                    y={M.top}
                    width={colW}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${x.label}: ${SERIES.map((s) => `${s.label} ${fmt(x[s.key])}`).join(", ")}`}
                  />
                </g>
              );
            })}
            {cap > 0n && (
              <>
                <line x1={M.left} x2={W - M.right} y1={capY} y2={capY} className="spend-chart__cap" />
                <text x={W - M.right} y={capY - 6} textAnchor="end" className="spend-chart__cap-label">cap {fmt(cap)}</text>
              </>
            )}
            <line x1={M.left} x2={W - M.right} y1={M.top + plotH} y2={M.top + plotH} className="spend-chart__axis" />
          </svg>
          {hover !== null && (
            <div className="chart-tooltip" role="status" style={{ left: `${((M.left + colW * hover + colW / 2) / W) * 100}%` }}>
              <strong>{days[hover].label}</strong>
              {SERIES.map((s) => (
                <div key={s.key} className="chart-tooltip__row">
                  <span className="chart-legend__swatch" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}: <strong>{fmt(days[hover][s.key])}</strong>
                </div>
              ))}
              <div className="chart-tooltip__row">Total: <strong>{fmt(totals[hover])} {d.token.symbol}</strong></div>
            </div>
          )}
        </div>
      )}
      {totals.every((t) => t === 0n) && <p className="ds-muted chart-empty">No payments out of this vault in the last {DAYS} days.</p>}
      <p className="ds-label chart-note">
        Built from the vault's PaymentExecuted, RequestApproved and EscrowReleased events. The cap limits autonomous spend (direct payments and escrow
        locks); owner-approved payments don't count toward it.
      </p>
    </Card>
  );
}
