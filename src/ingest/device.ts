/**
 * Coarse device classification from the user-agent.
 *
 * v1 buckets into `mobile` / `tablet` / `desktop` — enough for the dashboard's
 * device breakdown without bundling a heavy UA-parsing library. Order matters:
 * tablets are checked before phones (an Android tablet UA lacks the `Mobile`
 * token that marks an Android phone).
 */
export type Device = 'mobile' | 'desktop' | 'tablet';

const TABLET = /iPad|Android(?!.*Mobile)|Tablet|PlayBook|Silk/i;
const MOBILE = /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i;

export function deviceFromUa(userAgent: string | undefined): Device {
  if (userAgent === undefined || userAgent.trim() === '') return 'desktop';
  if (TABLET.test(userAgent)) return 'tablet';
  if (MOBILE.test(userAgent)) return 'mobile';
  return 'desktop';
}
