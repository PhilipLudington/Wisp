/**
 * Origin allowlist check — casual anti-spam, not authentication.
 *
 * The request `Origin` is compared against the site's `domains` JSON array.
 * It's spoofable by anything that isn't a browser (accepted at personal scale;
 * an HMAC token is deferred), but it cheaply blocks stray cross-site posts.
 */

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Return true if `origin` matches one of the site's allowed origins. A missing
 * Origin header, malformed `domains` JSON, or no match all return false.
 */
export function originAllowed(origin: string | undefined, domainsJson: string): boolean {
  if (origin === undefined || origin.trim() === '') return false;

  let domains: unknown;
  try {
    domains = JSON.parse(domainsJson);
  } catch {
    return false;
  }
  if (!Array.isArray(domains)) return false;

  const target = normalizeOrigin(origin);
  return domains.some((d) => typeof d === 'string' && normalizeOrigin(d) === target);
}
