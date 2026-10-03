// Reusable design-system components (see styles/design-system.css). Presentation only, no data logic.
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { useCaseFromReason } from "../lib/labels";

/** Status tones for chips. Black text on every tone keeps contrast high. */
export type Tone = "ok" | "pending" | "blocked" | "info" | "neutral" | "dark";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`ds-badge ds-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Card({ title, aside, children, className = "", tone, id }: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "mustard" | "pink" | "mint" | "canvas";
  id?: string;
}) {
  return (
    <section className={`ds-card ${tone ? `ds-card--${tone}` : ""} ${className}`} id={id}>
      {(title || aside) && (
        <header className="ds-card__head">
          {title && <h3 className="ds-card__title">{title}</h3>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** Large sentence-case section heading with an optional subtitle and right-hand action. */
export function SectionTitle({ title, sub, aside, id }: { title: string; sub?: string; aside?: ReactNode; id?: string }) {
  return (
    <div className="section-title" id={id}>
      <div>
        <h2 className="section-title__text">{title}</h2>
        {sub && <div className="section-title__sub">{sub}</div>}
      </div>
      {aside}
    </div>
  );
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`ds-button ${props.className ?? ""}`} />;
}

/** Square icon-only button; `label` is required for screen readers. */
export function IconButton({ label, children, small, href, onClick, ...rest }: {
  label: string;
  children: ReactNode;
  small?: boolean;
  href?: string;
  onClick?: () => void;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const cls = `ds-icon-button ${small ? "ds-icon-button--small" : ""}`;
  if (href) {
    return (
      <a className={cls} href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} aria-label={label} title={label} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export function IconBox({ children, bg }: { children: ReactNode; bg?: string }) {
  return (
    <span className="ds-icon-box" style={bg ? { background: bg } : undefined} aria-hidden="true">
      {children}
    </span>
  );
}

/** Small square stat: value on top, label below. */
export function StatBox({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="stat-box" title={title}>
      <div className="stat-box__value">{children}</div>
      <div className="stat-box__label">{label}</div>
    </div>
  );
}

/** Minimal SVG sparkline for a series of non-negative numbers (oldest first). */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 240;
  const h = 72;
  const pad = 6;
  if (values.length === 0) return null;
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (series.length - 1);
    const y = h - pad - (v / max) * (h - 2 * pad);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline className="sparkline__line" points={pts.map(([x, y]) => `${x},${y}`).join(" ")} vectorEffect="non-scaling-stroke" />
      <circle className="sparkline__dot" cx={last[0]} cy={last[1]} r={4} />
    </svg>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="ds-kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state" role="status">
      {icon && <IconBox>{icon}</IconBox>}
      <div className="empty-state__title">{title}</div>
      {children && <div className="ds-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode };

/** Bordered table; collapses to labelled blocks on phones. */
export function Table<T>({ title, aside, columns, rows, rowKey, empty }: {
  title: ReactNode;
  aside?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
}) {
  return (
    <div className="ds-table">
      <div className="ds-table__title">
        <span>{title}</span>
        {aside}
      </div>
      {rows.length === 0 ? (
        <div className="empty-state" style={{ border: 0, borderRadius: 0 }}>{empty}</div>
      ) : (
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} data-label={c.header}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Labelled chip for what a payment was for, derived from its reason code (see lib/labels.ts). */
export function UseCaseChip({ reason }: { reason: Hex | undefined }) {
  const u = useCaseFromReason(reason);
  return <span className={`usecase-chip usecase-chip--${u.kind}`}>{u.label}</span>;
}
