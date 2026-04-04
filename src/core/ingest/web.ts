import TurndownService from 'turndown';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'fs';
import { join, extname as pathExtname } from 'path';
import type { RawSource } from '../types.js';
import { slugify, fetchWithTimeout } from '../utils.js';
import { sanitizeUnicode } from '../sanitization.js';

const MAX_IMAGES = 50;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per image
const MAX_HTML_BYTES = 10 * 1024 * 1024;  // 10 MB for page HTML
const MAX_REDIRECTS = 5;

const HEADERS = {
  'User-Agent': 'browzy/0.1.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// ── SSRF Protection ──────────────────────────────────────────────

function isPrivateUrl(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return true; // Block unparseable URLs
  }

  const host = parsed.hostname.toLowerCase();

  // Obvious private hostnames
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) return true;

  const stripped = host.replace(/^\[|\]$/g, ''); // strip brackets for IPv6

  // Block octal/hex IP notation (bypass attempts like 0x7f000001, 0177.0.0.1)
  if (/^[0-9a-fx.:]+$/i.test(stripped) && (/0x/i.test(stripped) || /^0\d/.test(stripped))) {
    return true;
  }

  // IPv4 loopback and private ranges
  const v4Parts = stripped.split('.').map(Number);
  if (v4Parts.length === 4 && v4Parts.every(n => !isNaN(n))) {
    if (v4Parts[0] === 127) return true;                                    // 127.0.0.0/8
    if (v4Parts[0] === 10) return true;                                     // 10.0.0.0/8
    if (v4Parts[0] === 172 && v4Parts[1] >= 16 && v4Parts[1] <= 31) return true; // 172.16.0.0/12
    if (v4Parts[0] === 192 && v4Parts[1] === 168) return true;             // 192.168.0.0/16
    if (v4Parts[0] === 169 && v4Parts[1] === 254) return true;             // 169.254.0.0/16 (link-local / cloud metadata)
    if (v4Parts[0] === 0) return true;                                      // 0.0.0.0/8
  }

  // Block bare decimal IP (e.g., 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(stripped) && parseInt(stripped, 10) > 0) return true;

  // IPv6 private ranges
  if (stripped === '::1') return true;                                        // loopback
  if (stripped.startsWith('fc') || stripped.startsWith('fd')) return true;    // fc00::/7 unique local
  if (stripped.startsWith('fe80')) return true;                               // fe80::/10 link-local
  if (stripped.startsWith('::ffff:')) return true;                            // IPv4-mapped IPv6

  return false;
}

// ── Redirect Validation ──────────────────────────────────────────

function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const orig = new URL(originalUrl);
    const redir = new URL(redirectUrl);

    // Block private redirect targets
    if (isPrivateUrl(redirectUrl)) return false;

    // No credentials in redirect
    if (redir.username || redir.password) return false;

    // Must stay same host (allow www add/remove)
    const stripWww = (h: string) => h.replace(/^www\./, '');
    return stripWww(orig.hostname) === stripWww(redir.hostname);
  } catch {
    return false;
  }
}

async function fetchFollowingSafeRedirects(
  url: string,
  options: RequestInit = {},
  depth = 0
): Promise<Response> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`);
  }

  const response = await fetchWithTimeout(url, { ...options, timeoutMs: 30_000 });

  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect missing Location header');

    const redirectUrl = new URL(location, url).href;
    if (!isPermittedRedirect(url, redirectUrl)) {
      throw new Error(`Blocked redirect from ${new URL(url).hostname} to ${new URL(redirectUrl).hostname}`);
    }
    return fetchFollowingSafeRedirects(redirectUrl, options, depth + 1);
  }

  return response;
}

// ── Image Extension Extraction ───────────────────────────────────

function safeImageExt(imgUrl: string): string {
  try {
    const pathname = new URL(imgUrl).pathname;
    const ext = pathExtname(pathname).toLowerCase().replace(/^\./, '');
    const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
    return allowed.has(ext) ? ext : 'png';
  } catch {
    return 'png';
  }
}

// ── Main ─────────────────────────────────────────────────────────

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export async function ingestWeb(
  url: string,
  dataDir: string
): Promise<RawSource> {
  if (url.length > 2000) {
    throw new Error('URL exceeds maximum length of 2000 characters');
  }

  if (isPrivateUrl(url)) {
    throw new Error('Cannot fetch private or internal URLs');
  }

  const response = await fetchFollowingSafeRedirects(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  // Content-type guard
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/') && !contentType.includes('html') && !contentType.includes('xml')) {
    throw new Error(`Unexpected content type: ${contentType}. Expected HTML or text.`);
  }

  // Content-length guard (pre-read)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_HTML_BYTES) {
    throw new Error(`Page too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds ${(MAX_HTML_BYTES / 1024 / 1024).toFixed(0)}MB limit`);
  }

  const html = await response.text();
  // Post-read size check (content-length can be missing or wrong)
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
    throw new Error('Page content exceeds size limit');
  }
  const markdown = sanitizeUnicode(turndown.turndown(html));

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = sanitizeUnicode(titleMatch?.[1]?.trim() || url);

  // Download images (capped, with SSRF + size checks)
  const images: string[] = [];
  const imgRegex = /<img[^>]+src="([^"]+)"/g;
  let match;
  while ((match = imgRegex.exec(html)) !== null && images.length < MAX_IMAGES) {
    try {
      const imgUrl = new URL(match[1], url).href;
      if (isPrivateUrl(imgUrl)) continue;

      const imgResponse = await fetchWithTimeout(imgUrl, {
        headers: { 'User-Agent': 'browzy/0.1.0' },
        timeoutMs: 15_000,
      });
      if (!imgResponse.ok) continue;

      const contentLength = parseInt(imgResponse.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_IMAGE_BYTES) continue;

      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) continue;

      const ext = safeImageExt(imgUrl);
      const imgFilename = `${createHash('sha256').update(imgUrl).digest('hex').slice(0, 12)}.${ext}`;
      const imgPath = join(dataDir, 'raw', 'images', imgFilename);
      writeFileSync(imgPath, buffer);
      images.push(imgPath);
    } catch {
      // Skip failed image downloads
    }
  }

  const id = createHash('sha256').update(url).digest('hex').slice(0, 12);
  const filename = `${slugify(title)}-${id}.md`;

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: ${JSON.stringify(url)}`,
    `type: web`,
    `ingested: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    '',
  ].join('\n');

  const path = join(dataDir, 'raw', filename);
  writeFileSync(path, frontmatter + markdown, 'utf-8');

  return {
    id,
    type: 'web',
    title,
    origin: url,
    path,
    images,
    ingestedAt: new Date().toISOString(),
  };
}
