/**
 * Living Wiki — stale source detection.
 * Checks web sources for staleness via HEAD requests on startup.
 */

import type { RawSource } from '../types.js';

/**
 * Basic SSRF check — block private/internal URLs before making requests.
 */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local') || host.endsWith('.internal')) return true;
    const stripped = host.replace(/^\[|\]$/g, '');
    const v4Parts = stripped.split('.').map(Number);
    if (v4Parts.length === 4 && v4Parts.every(n => !isNaN(n))) {
      if (v4Parts[0] === 127 || v4Parts[0] === 10 || v4Parts[0] === 0) return true;
      if (v4Parts[0] === 172 && v4Parts[1] >= 16 && v4Parts[1] <= 31) return true;
      if (v4Parts[0] === 192 && v4Parts[1] === 168) return true;
      if (v4Parts[0] === 169 && v4Parts[1] === 254) return true;
    }
    // IPv6 private ranges
    if (stripped === '::1' || stripped.startsWith('fc') || stripped.startsWith('fd') ||
        stripped.startsWith('fe80') || stripped.startsWith('::ffff:')) return true;
    return false;
  } catch {
    return true;
  }
}

export interface StaleSource {
  origin: string;
  title: string;
  reason: string;
}

export async function checkStaleSources(
  manifest: RawSource[],
  maxAge: number = 7 * 24 * 60 * 60 * 1000, // 7 days default
): Promise<StaleSource[]> {
  const stale: StaleSource[] = [];
  const webSources = manifest.filter(s => s.type === 'web');

  // Only check sources older than maxAge
  const now = Date.now();
  const oldSources = webSources.filter(s => {
    const age = now - new Date(s.ingestedAt).getTime();
    return age > maxAge;
  });

  // Deterministic source selection: sort by ingestedAt ascending (oldest first)
  const sortedSources = [...oldSources].sort(
    (a, b) => new Date(a.ingestedAt).getTime() - new Date(b.ingestedAt).getTime()
  );

  // HEAD requests in parallel (max 10 sources checked)
  const checks = sortedSources.slice(0, 10).map(async (source) => {
    // SSRF protection: skip private/internal URLs
    if (isPrivateUrl(source.origin)) return;

    try {
      const response = await fetch(source.origin, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
        redirect: 'follow',
      });

      const lastModified = response.headers.get('last-modified');
      if (lastModified) {
        const remoteDate = new Date(lastModified);
        const localDate = new Date(source.ingestedAt);
        if (remoteDate > localDate) {
          stale.push({
            origin: source.origin,
            title: source.title,
            reason: `updated ${remoteDate.toLocaleDateString()}`,
          });
        }
      } else {
        // Fallback: check ETag — if server provides one, compare with stored value
        const etag = response.headers.get('etag');
        if (etag && (source as any).etag && etag !== (source as any).etag) {
          stale.push({
            origin: source.origin,
            title: source.title,
            reason: 'content changed (ETag mismatch)',
          });
        }
      }
    } catch {
      // Network error — skip, don't flag as stale
    }
  });

  await Promise.allSettled(checks);
  return stale;
}
