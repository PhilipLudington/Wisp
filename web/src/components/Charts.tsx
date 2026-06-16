import type { DayCount } from '../types.js';

/**
 * Dependency-free SVG charts.
 *
 * Two shapes cover every panel: an area/line for the pageviews series and bars
 * for the per-day unique-visitors series. Both draw into a fixed viewBox and
 * scale to their container via CSS width; `vector-effect="non-scaling-stroke"`
 * keeps strokes crisp at any width. Keeping charts hand-rolled holds the
 * dashboard bundle small — in keeping with Wisp's ~1KB-tracker ethos.
 */

const W = 600;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

/** Short `MM-DD` label from a `YYYY-MM-DD` day bucket. */
function shortDay(day: string): string {
  return day.slice(5);
}

/** Map values to a [0, plotH] pixel height; a flat-zero series stays at baseline. */
function scaler(values: number[], plotH: number): (v: number) => number {
  const max = Math.max(1, ...values);
  return (v) => (v / max) * plotH;
}

function Empty(): React.JSX.Element {
  return <div className="chart-empty">No data in this range.</div>;
}

/** Sparse x-axis ticks: first, last, and a few between, never crowding. */
function ticks(n: number): number[] {
  if (n <= 1) return [0];
  const want = Math.min(n, 6);
  const step = (n - 1) / (want - 1);
  const out = new Set<number>();
  for (let i = 0; i < want; i++) out.add(Math.round(i * step));
  return [...out];
}

export function LineChart({ data }: { data: DayCount[] }): React.JSX.Element {
  if (data.length === 0) return <Empty />;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotH;
  const scale = scaler(
    data.map((d) => d.count),
    plotH,
  );
  const x = (i: number): number =>
    PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number): number => baseline - scale(v);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.count)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${baseline} L${x(0)},${baseline} Z`;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      <path className="chart-area" d={area} />
      <path className="chart-line" d={line} fill="none" vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => (
        <circle key={d.day} className="chart-dot" cx={x(i)} cy={y(d.count)} r={2.5}>
          <title>{`${d.day}: ${d.count.toLocaleString()}`}</title>
        </circle>
      ))}
      {ticks(data.length).map((i) => {
        const d = data[i];
        return d ? (
          <text key={d.day} className="chart-xlabel" x={x(i)} y={H - 6} textAnchor="middle">
            {shortDay(d.day)}
          </text>
        ) : null;
      })}
    </svg>
  );
}

export function BarChart({ data }: { data: DayCount[] }): React.JSX.Element {
  if (data.length === 0) return <Empty />;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotH;
  const scale = scaler(
    data.map((d) => d.count),
    plotH,
  );
  const slot = plotW / data.length;
  const barW = Math.max(2, slot * 0.6);
  const tickIdx = new Set(ticks(data.length));

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {data.map((d, i) => {
        const h = scale(d.count);
        const cx = PAD.left + slot * i + slot / 2;
        return (
          <g key={d.day}>
            <rect
              className="chart-bar"
              x={cx - barW / 2}
              y={baseline - h}
              width={barW}
              height={Math.max(0, h)}
              rx={1}
            >
              <title>{`${d.day}: ${d.count.toLocaleString()} visitors`}</title>
            </rect>
            {tickIdx.has(i) && (
              <text className="chart-xlabel" x={cx} y={H - 6} textAnchor="middle">
                {shortDay(d.day)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
