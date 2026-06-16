import type { LabelCount, PageviewsResponse, Range, SiteSummary } from './types.js';

/**
 * Thin client for the Wisp read API.
 *
 * Every call shares the same origin as the dashboard (the Hono process serves
 * both), so the signed auth cookie rides along automatically. A 401 surfaces as
 * {@link Unauthorized} so the UI can drop back to the login screen instead of
 * rendering a broken panel.
 */

/** Thrown when the server rejects a request for lack of (or expired) auth. */
export class Unauthorized extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'Unauthorized';
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(`request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Encode a {@link Range} as the query the stats API expects. */
function rangeQuery(range: Range): string {
  const p =
    range.kind === 'preset'
      ? { range: range.preset }
      : { from: String(range.from), to: String(range.to) };
  return new URLSearchParams(p).toString();
}

function siteRange(site: string, panel: string, range: Range): string {
  return `/api/sites/${encodeURIComponent(site)}/${panel}?${rangeQuery(range)}`;
}

export const api = {
  /** Whether the current cookie is valid; never throws Unauthorized. */
  me: () => getJson<{ authed: boolean }>('/api/me'),

  /** Exchange the password for a session cookie; resolves to success boolean. */
  async login(password: string): Promise<boolean> {
    const res = await postJson('/api/login', { password });
    return res.ok;
  },

  async logout(): Promise<void> {
    await postJson('/api/logout', {});
  },

  sites: () => getJson<{ sites: SiteSummary[] }>('/api/sites'),

  pageviews: (site: string, range: Range) =>
    getJson<PageviewsResponse>(siteRange(site, 'pageviews', range)),

  visitors: (site: string, range: Range) =>
    getJson<{ series: { day: string; count: number }[] }>(siteRange(site, 'visitors', range)),

  pages: (site: string, range: Range) =>
    getJson<{ pages: LabelCount[] }>(siteRange(site, 'pages', range)),

  referrers: (site: string, range: Range) =>
    getJson<{ referrers: LabelCount[] }>(siteRange(site, 'referrers', range)),

  devices: (site: string, range: Range) =>
    getJson<{ devices: LabelCount[] }>(siteRange(site, 'devices', range)),

  events: (site: string, range: Range) =>
    getJson<{ events: LabelCount[] }>(siteRange(site, 'events', range)),

  current: (site: string) =>
    getJson<{ current: number }>(`/api/sites/${encodeURIComponent(site)}/current`),
};
