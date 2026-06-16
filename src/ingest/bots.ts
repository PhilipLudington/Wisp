/**
 * Bot filtering: a maintained substring blocklist plus cheap heuristics.
 *
 * This will never be complete (see DESIGN risks) — the goal is to drop the
 * obvious, well-behaved bots and non-browser clients so counts are "good
 * enough". Dropped traffic is logged by the caller for audit.
 */

/** Lowercased substrings that mark a user-agent as a bot/non-browser client. */
const BOT_SUBSTRINGS = [
  'bot',
  'crawl',
  'spider',
  'slurp',
  'bingpreview',
  'facebookexternalhit',
  'embedly',
  'quora link preview',
  'pingdom',
  'uptimerobot',
  'monitor',
  'headless',
  'phantom',
  'puppeteer',
  'playwright',
  'selenium',
  'python-requests',
  'aiohttp',
  'httpclient',
  'curl',
  'wget',
  'axios',
  'go-http-client',
  'java/',
  'okhttp',
  'scrapy',
  'semrush',
  'ahrefs',
  'mj12',
  'dotbot',
  'dataforseo',
  'google-read-aloud',
  'lighthouse',
  'gtmetrix',
  'archive.org_bot',
];

export interface BotVerdict {
  isBot: boolean;
  reason?: string;
}

/**
 * Classify a user-agent. Missing/blank UAs and anything lacking the ubiquitous
 * `Mozilla` token are treated as bots, as is any blocklist substring match.
 */
export function detectBot(userAgent: string | undefined): BotVerdict {
  if (userAgent === undefined || userAgent.trim() === '') {
    return { isBot: true, reason: 'missing-ua' };
  }
  const low = userAgent.toLowerCase();
  for (const s of BOT_SUBSTRINGS) {
    if (low.includes(s)) return { isBot: true, reason: `ua-match:${s}` };
  }
  // Effectively every real browser UA contains "Mozilla/5.0".
  if (!low.includes('mozilla')) {
    return { isBot: true, reason: 'non-browser-ua' };
  }
  return { isBot: false };
}
