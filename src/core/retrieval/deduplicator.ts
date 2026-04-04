/**
 * Source deduplication — prevents re-ingesting the same content.
 *
 * Checks:
 * 1. URL normalization (strip tracking params, fragments)
 * 2. Manifest lookup (exact origin match)
 * 3. Content hash (for files — same content, different path)
 *
 * Reference: Claude Code uses mtime-based file state caching
 * to skip unchanged files. We adapt for source ingestion.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import type { RawSource } from '../types.js';

/**
 * Normalize a URL for deduplication.
 * Strips tracking params, fragments, trailing slashes.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    // Remove fragment
    parsed.hash = '';
    // Remove trailing slash
    let normalized = parsed.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Hash file content for deduplication.
 */
export function hashFileContent(filePath: string): string {
  if (!existsSync(filePath)) return '';
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export interface DuplicateCheck {
  isDuplicate: boolean;
  existingSource?: RawSource;
  reason?: string;
}

/**
 * Check if a source already exists in the manifest.
 */
export function checkDuplicate(
  input: string,
  manifest: RawSource[],
): DuplicateCheck {
  const isUrl = input.startsWith('http://') || input.startsWith('https://');

  if (isUrl) {
    const normalized = normalizeUrl(input);
    const existing = manifest.find(s => {
      if (s.type !== 'web') return false;
      return normalizeUrl(s.origin) === normalized;
    });

    if (existing) {
      return {
        isDuplicate: true,
        existingSource: existing,
        reason: `Already ingested as "${existing.title}" (${existing.id})`,
      };
    }
  } else {
    // File: check by path and content hash
    const existing = manifest.find(s => s.origin === input);
    if (existing) {
      return {
        isDuplicate: true,
        existingSource: existing,
        reason: `Already ingested as "${existing.title}" (${existing.id})`,
      };
    }

    // Also check content hash for files with different paths but same content.
    // Use cached contentHash from manifest entries instead of re-reading every file.
    if (existsSync(input)) {
      const hash = hashFileContent(input);
      const contentMatch = manifest.find(s => {
        if (s.type === 'web') return false;
        // Use stored contentHash when available; fall back to re-hashing
        if (s.contentHash) return s.contentHash === hash;
        if (!existsSync(s.origin)) return false;
        // Slow path: no cached contentHash — re-reading file from disk
        console.warn(`[dedup] No cached contentHash for "${s.title}" (${s.origin}), falling back to file read. Re-ingest to cache the hash.`);
        return hashFileContent(s.origin) === hash;
      });

      if (contentMatch) {
        return {
          isDuplicate: true,
          existingSource: contentMatch,
          reason: `Same content as "${contentMatch.title}" (different path)`,
        };
      }
    }
  }

  return { isDuplicate: false };
}
