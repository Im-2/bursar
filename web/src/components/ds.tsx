// Reusable design-system components (see styles/design-system.css). Presentation only, no data logic.
import type { ReactNode } from "react";

export type Tone = "green" | "amber" | "red" | "lime" | "gray" | "black";

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`ds-badge ds-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Card({ title, aside, children, className = "" }: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ds-card ${className}`}>
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

export function SectionBar({ title, eyebrow, aside, id }: { title: string; eyebrow?: string; aside?: ReactNode; id?: string }) {
  return (
    <div className="ds-section-bar" id={id}>
      <div className="ds-section-bar__inner">
        <div>
          {eyebrow && <div className="ds-section-bar__eyebrow">{eyebrow}</div>}
          <h2 className="ds-section-bar__title">{title}</h2>
        </div>
        {aside}
      </div>
    </div>
  );
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`ds-button ${props.className ?? ""}`} />;
}

export function Stat({ label, children, unit }: { label: string; children: ReactNode; unit?: string }) {
  return (
    <div>
      <div className="ds-label">{label}</div>
      <div className="ds-stat__value">
        {children}
        {unit && <span className="ds-stat__unit">{unit}</span>}
      </div>
    </div>
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

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode };

/** Black title strip, thick row dividers; collapses to labelled blocks on phones. */
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
        <div className="ds-table__empty">{empty}</div>
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
