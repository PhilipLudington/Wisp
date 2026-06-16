import { useState } from 'react';
import type { Range, RangePreset } from '../types.js';

/**
 * Range selector: three presets plus a custom `[from, to)` window.
 *
 * Presets map straight to the API's `range` param. Custom uses two date inputs;
 * the window is built in UTC (matching the collector's day buckets) as
 * `[from 00:00, to+1 00:00)`, so the chosen end day is included.
 */

const PRESETS: RangePreset[] = ['24h', '7d', '30d'];
const DAY_MS = 24 * 60 * 60 * 1000;

function dayToUtcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function RangePicker({
  range,
  onChange,
}: {
  range: Range;
  onChange: (r: Range) => void;
}): React.JSX.Element {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  function applyCustom(nextFrom: string, nextTo: string): void {
    if (!nextFrom || !nextTo) return;
    const f = dayToUtcMs(nextFrom);
    const t = dayToUtcMs(nextTo) + DAY_MS; // include the end day
    if (Number.isFinite(f) && Number.isFinite(t) && f < t) {
      onChange({ kind: 'custom', from: f, to: t });
    }
  }

  return (
    <div className="rangepicker">
      <div className="seg">
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p}
            className={
              'seg-btn' + (range.kind === 'preset' && range.preset === p ? ' seg-btn-on' : '')
            }
            onClick={() => {
              setCustom(false);
              onChange({ kind: 'preset', preset: p });
            }}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className={'seg-btn' + (range.kind === 'custom' || custom ? ' seg-btn-on' : '')}
          onClick={() => setCustom((v) => !v)}
        >
          Custom
        </button>
      </div>
      {custom && (
        <div className="custom-range">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              applyCustom(e.target.value, to);
            }}
          />
          <span className="custom-sep">→</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              applyCustom(from, e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
