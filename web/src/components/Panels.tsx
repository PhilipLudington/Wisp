import type { Resource } from '../hooks.js';
import type { LabelCount } from '../types.js';

/**
 * Shared panel scaffolding.
 *
 * `Panel` renders a titled card and a single body. `Async` adapts a
 * {@link Resource} into the right body — a skeleton while loading, the error
 * text on failure, or the resolved content — so each panel stays declarative.
 */

export function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {aside}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Async<T>({
  res,
  children,
}: {
  res: Resource<T>;
  children: (data: T) => React.ReactNode;
}): React.JSX.Element {
  if (res.error) return <p className="panel-error">{res.error}</p>;
  if (res.loading || res.data === undefined) return <div className="panel-skeleton" />;
  return <>{children(res.data)}</>;
}

/** A ranked list of label/count rows with a proportional fill bar. */
export function TopList({
  rows,
  emptyLabel = 'Nothing yet.',
}: {
  rows: LabelCount[];
  emptyLabel?: string;
}): React.JSX.Element {
  if (rows.length === 0) return <p className="list-empty">{emptyLabel}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="toplist">
      {rows.map((r) => (
        <li className="toplist-row" key={r.label}>
          <span className="toplist-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          <span className="toplist-label" title={r.label}>
            {r.label}
          </span>
          <span className="toplist-count">{r.count.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
