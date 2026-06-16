import type { Resource } from '../hooks.js';
import type { Goal, LabelCount } from '../types.js';

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

/**
 * A goal's headline count: how many times its custom event fired in the range.
 * Derived from the custom-events list the dashboard already fetches, so a new
 * goal needs no new endpoint — just an entry in `sites.config.goals`.
 */
export function GoalPanel({ goal, rows }: { goal: Goal; rows: LabelCount[] }): React.JSX.Element {
  const count = rows.find((r) => r.label === goal.event)?.count ?? 0;
  return (
    <div className="goal">
      <span className="goal-count">{count.toLocaleString()}</span>
      <span className="goal-event">{goal.event}</span>
    </div>
  );
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
