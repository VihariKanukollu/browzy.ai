/**
 * LRU cache for query results.
 *
 * Prevents redundant LLM calls for repeated queries.
 * 30-minute TTL, 50 entry limit, generation-based invalidation on ingest.
 */

import { createHash } from 'crypto';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  generation: number;
}

class QueryCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private generation = 0;

  constructor(maxEntries = 50, ttlMs = 30 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  private makeKey(query: string, format: string, model: string): string {
    return createHash('sha256')
      .update(`${query}\0${format}\0${model}`)
      .digest('hex')
      .slice(0, 16);
  }

  get(query: string, format: string, model: string): T | undefined {
    const key = this.makeKey(query, format, model);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Check generation (invalidated by ingest)
    if (entry.generation < this.generation) {
      this.cache.delete(key);
      return undefined;
    }

    // Promote to most-recently-used (move to end of Map)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(query: string, format: string, model: string, value: T): void {
    const key = this.makeKey(query, format, model);

    // LRU eviction if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      generation: this.generation,
    });
  }

  invalidate(): void {
    this.generation++;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance
export const queryCache = new QueryCache();
