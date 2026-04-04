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
    const rawUrl = resultMatch[1];
    const actualUrl = decodeURIComponent(rawUrl.replace(/.*uddg=/, '').replace(/&.*/, ''));

    // Block private/internal URLs from search results (SSRF protection)
    try {
      const urlObj = new URL(actualUrl);
      const hostname = urlObj.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
          hostname.endsWith('.local') || hostname.endsWith('.internal') ||
          /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
        return null;
      }
    } catch {
      return null; // malformed URL
    }

    const title = resultMatch[2].trim();

    // Get snippet
    const snippetMatch = html.match(/<a[^>]*class="result__snippet"[^>]*>([^<]+)/);
    const snippet = snippetMatch ? snippetMatch[1].trim().slice(0, 100) : '';

    return { url: actualUrl, title, snippet };
  } catch {
    return null; // Silently fail — gap hunter is best-effort
  }
}
