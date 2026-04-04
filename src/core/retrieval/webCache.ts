/**
 * LRU cache for web fetches.
 *
 * Prevents re-fetching the same URL within a session.
 * 15-minute TTL, 50MB size limit.
 *
 * Reference: Claude Code uses LRUCache with:
 * - maxSize: 50MB
 * - ttl: 15 minutes
 * - Size calculated from content length
 */

interface CacheEntry {
  content: string;
  fetchedAt: number;
  sizeBytes: number;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

class WebFetchCache {
  private cache = new Map<string, CacheEntry>();
  private totalBytes = 0;

  get(url: string): string | null {
    const entry = this.cache.get(url);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.fetchedAt > TTL_MS) {
      this.delete(url);
      return null;
    }

    return entry.content;
  }

  set(url: string, content: string): void {
    // Remove old entry if exists
    if (this.cache.has(url)) {
      this.delete(url);
    }

    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    // Evict oldest entries if we'd exceed size limit
    while (this.totalBytes + sizeBytes > MAX_CACHE_SIZE_BYTES && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.delete(oldestKey);
      else break;
    }

    // Don't cache if single entry exceeds limit
    if (sizeBytes > MAX_CACHE_SIZE_BYTES) return;

    this.cache.set(url, {
      content,
      fetchedAt: Date.now(),
      sizeBytes,
    });
    this.totalBytes += sizeBytes;
  }

  private delete(url: string): void {
    const entry = this.cache.get(url);
    if (entry) {
      this.totalBytes -= entry.sizeBytes;
      this.cache.delete(url);
    }
  }

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get bytesUsed(): number {
    return this.totalBytes;
  }
}

// Singleton instance
export const webCache = new WebFetchCache();
