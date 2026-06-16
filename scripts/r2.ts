import { createHash, createHmac } from 'node:crypto';

/**
 * Minimal Cloudflare R2 (S3-compatible) object upload via AWS Signature V4.
 *
 * R2 speaks the S3 API, so a single authenticated `PUT` object request is all
 * the backup job needs. Implementing SigV4 directly (Node's `crypto` + the
 * global `fetch`) keeps Wisp dependency-free — no `@aws-sdk/*` in the tree for
 * one nightly upload. Only PUT is implemented; retention is handled by R2
 * bucket lifecycle rules (see BACKUP.md), not by this client.
 *
 * R2 uses the fixed region `auto` and path-style addressing against the
 * account endpoint `https://<account-id>.r2.cloudflarestorage.com`.
 */

const REGION = 'auto';
const SERVICE = 's3';

export interface R2Target {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Derive the SigV4 signing key for the given date/region/service. */
function signingKey(secret: string, datestamp: string): Buffer {
  const kDate = hmac('AWS4' + secret, datestamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

/** SigV4 timestamps: `20060102T150405Z` and `20060102`. */
function timestamps(now: Date): { amzDate: string; datestamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, datestamp: amzDate.slice(0, 8) };
}

/**
 * Upload `body` to `r2://<bucket>/<key>` as a PUT object. Throws on any
 * non-2xx response (with the status and R2's error body for diagnosis).
 */
export async function putObject(
  target: R2Target,
  key: string,
  body: Buffer,
  contentType = 'application/octet-stream',
  now: Date = new Date(),
): Promise<void> {
  const host = `${target.accountId}.r2.cloudflarestorage.com`;
  // Path-style: /<bucket>/<key>. Each path segment is URI-encoded but the
  // separating slashes are preserved.
  const canonicalUri =
    '/' +
    [target.bucket, ...key.split('/')]
      .map((seg) => encodeURIComponent(seg))
      .join('/');

  const { amzDate, datestamp } = timestamps(now);
  const payloadHash = sha256Hex(body);

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '', // empty query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${datestamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac('sha256', signingKey(target.secretAccessKey, datestamp))
    .update(stringToSign)
    .digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      // `host` is set automatically by fetch from the URL and matches what we
      // signed; S3 only validates the headers listed in SignedHeaders.
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization,
      'content-type': contentType,
      'content-length': String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${res.statusText}\n${detail}`);
  }
}
