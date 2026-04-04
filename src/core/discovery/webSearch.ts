/**
 * Decode common HTML entities in a string.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export async function searchWeb(query: string): Promise<{ url: string; title: string; snippet: string } | null> {
  try {
    // Use DuckDuckGo HTML search — no API key needed
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'browzy/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    const html = await response.text();

    // Parse first result — look for <a class="result__a" href="...">
    const resultMatch = html.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)/);
    if (!resultMatch) return null;

    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    // Use URL parser with uddg param for robust extraction
    const rawUrl = resultMatch[1];
    let actualUrl: string;
    try {
      const parsed = new URL(rawUrl, 'https://duckduckgo.com');
      const uddg = parsed.searchParams.get('uddg');
      actualUrl = uddg ? decodeURIComponent(uddg) : decodeURIComponent(rawUrl);
    } catch {
      // Fallback: regex extraction
      actualUrl = decodeURIComponent(rawUrl.replace(/.*uddg=/, '').replace(/&.*/, ''));
    }

    // Block private/internal URLs from search results (SSRF protection)
    try {
      const urlObj = new URL(actualUrl);
      const hostname = urlObj.hostname.toLowerCase();
      const stripped = hostname.replace(/^\[|\]$/g, '');
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
          hostname.endsWith('.local') || hostname.endsWith('.internal') ||
          /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname) ||
          // IPv6 private ranges
          stripped === '::1' ||
          stripped.startsWith('fc') || stripped.startsWith('fd') ||
          stripped.startsWith('fe80') || stripped.startsWith('::ffff:')) {
        return null;
      }
    } catch {
      return null; // malformed URL
    }

    const title = decodeHtmlEntities(resultMatch[2].trim());

    // Get snippet — decode HTML entities
    const snippetMatch = html.match(/<a[^>]*class="result__snippet"[^>]*>([^<]+)/);
    const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1].trim()).slice(0, 100) : '';

    return { url: actualUrl, title, snippet };
  } catch {
    return null; // Silently fail — gap hunter is best-effort
  }
}
