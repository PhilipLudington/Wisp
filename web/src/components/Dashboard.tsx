import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { usePoll, useResource } from '../hooks.js';
import type { Range, SiteSummary } from '../types.js';
import { BarChart, LineChart } from './Charts.js';
import { Async, Panel, TopList } from './Panels.js';
import { RangePicker } from './RangePicker.js';

/**
 * The signed-in view: a header (site switcher, range, live count, sign-out)
 * over a grid of panels. Every panel re-fetches when the selected site or range
 * changes; a 401 from any of them bubbles up through `onUnauthed` to the login
 * gate.
 */
export function Dashboard({
  onUnauthed,
  onLogout,
}: {
  onUnauthed: () => void;
  onLogout: () => void;
}): React.JSX.Element {
  const sites = useResource(() => api.sites().then((r) => r.sites), [], onUnauthed);
  const [site, setSite] = useState<string>();
  const [range, setRange] = useState<Range>({ kind: 'preset', preset: '7d' });

  // Default the switcher to the first site once the list arrives.
  useEffect(() => {
    if (site === undefined && sites.data && sites.data.length > 0) {
      setSite(sites.data[0]!.key);
    }
  }, [sites.data, site]);

  return (
    <div className="dash">
      <Header
        sites={sites.data}
        site={site}
        onSite={setSite}
        range={range}
        onRange={setRange}
        onLogout={onLogout}
        onUnauthed={onUnauthed}
      />
      {site ? (
        <Panels site={site} range={range} onUnauthed={onUnauthed} />
      ) : (
        <div className="dash-empty">
          {sites.loading ? 'Loading sites…' : 'No sites registered. Seed one to begin.'}
        </div>
      )}
    </div>
  );
}

function Header({
  sites,
  site,
  onSite,
  range,
  onRange,
  onLogout,
  onUnauthed,
}: {
  sites: SiteSummary[] | undefined;
  site: string | undefined;
  onSite: (key: string) => void;
  range: Range;
  onRange: (r: Range) => void;
  onLogout: () => void;
  onUnauthed: () => void;
}): React.JSX.Element {
  return (
    <header className="dash-head">
      <div className="dash-head-left">
        <span className="brand">wisp</span>
        {sites && sites.length > 0 && site && (
          <select
            className="site-switcher"
            value={site}
            onChange={(e) => onSite(e.target.value)}
            aria-label="Site"
          >
            {sites.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="dash-head-right">
        {site && <CurrentVisitors site={site} onUnauthed={onUnauthed} />}
        <RangePicker range={range} onChange={onRange} />
        <button type="button" className="btn" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}

function CurrentVisitors({
  site,
  onUnauthed,
}: {
  site: string;
  onUnauthed: () => void;
}): React.JSX.Element {
  const data = usePoll(() => api.current(site), 15_000, site, onUnauthed);
  const n = data?.current ?? 0;
  return (
    <span className="live" title="Distinct visitors in the last 5 minutes">
      <span className="live-dot" />
      {n.toLocaleString()} online
    </span>
  );
}

function Panels({
  site,
  range,
  onUnauthed,
}: {
  site: string;
  range: Range;
  onUnauthed: () => void;
}): React.JSX.Element {
  // A stable key for the resource deps: site + serialized range.
  const key = useMemo(() => JSON.stringify([site, range]), [site, range]);

  const pageviews = useResource(() => api.pageviews(site, range), [key], onUnauthed);
  const visitors = useResource(
    () => api.visitors(site, range).then((r) => r.series),
    [key],
    onUnauthed,
  );
  const pages = useResource(() => api.pages(site, range).then((r) => r.pages), [key], onUnauthed);
  const referrers = useResource(
    () => api.referrers(site, range).then((r) => r.referrers),
    [key],
    onUnauthed,
  );
  const devices = useResource(
    () => api.devices(site, range).then((r) => r.devices),
    [key],
    onUnauthed,
  );
  const events = useResource(
    () => api.events(site, range).then((r) => r.events),
    [key],
    onUnauthed,
  );

  return (
    <main className="grid">
      <Panel
        title="Pageviews"
        aside={
          <Async res={pageviews}>
            {(d) => <span className="panel-total">{d.total.toLocaleString()}</span>}
          </Async>
        }
      >
        <Async res={pageviews}>{(d) => <LineChart data={d.series} />}</Async>
      </Panel>

      <Panel
        title="Unique visitors"
        aside={<span className="panel-note">per day — no range total</span>}
      >
        <Async res={visitors}>{(series) => <BarChart data={series} />}</Async>
      </Panel>

      <Panel title="Top pages">
        <Async res={pages}>
          {(rows) => <TopList rows={rows} emptyLabel="No pageviews yet." />}
        </Async>
      </Panel>

      <Panel title="Top referrers">
        <Async res={referrers}>
          {(rows) => <TopList rows={rows} emptyLabel="No referrers yet." />}
        </Async>
      </Panel>

      <Panel title="Devices">
        <Async res={devices}>{(rows) => <TopList rows={rows} emptyLabel="No data yet." />}</Async>
      </Panel>

      <Panel title="Custom events">
        <Async res={events}>
          {(rows) => <TopList rows={rows} emptyLabel="No custom events tracked." />}
        </Async>
      </Panel>
    </main>
  );
}
