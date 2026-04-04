import { basename } from 'path';
import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import type { RawSource } from '../types.js';

export interface IngestPreview {
  title: string;
  type: string;
  wordCount: number;
  detectedTopics: string[];
  wikiConnections: Array<{ slug: string; title: string }>;
  excerpt: string;
}

/**
 * Generate a zero-LLM-cost preview from an ingested source.
 * Uses metadata + FTS search only — no API calls.
 */
export function generateIngestPreview(source: RawSource, dataDir: string): IngestPreview {
  const fs = new FilesystemStorage(dataDir);
  const db = new SQLiteStorage(dataDir);

  try {
    const rawContent = fs.readRawSource(basename(source.path));
    const wordCount = rawContent.split(/\s+/).length;

    // Find wiki connections via FTS
    const searchTerms = [source.title, ...(source.tags || [])].filter(Boolean);
    const connections: IngestPreview['wikiConnections'] = [];
    const seen = new Set<string>();

    for (const term of searchTerms.slice(0, 3)) {
      try {
        const results = db.search(term, 3);
        for (const r of results) {
          if (r.slug.startsWith('raw-')) continue;
          if (seen.has(r.slug)) continue;
          seen.add(r.slug);
          connections.push({ slug: r.slug, title: r.title });
        }
      } catch { /* FTS search is best-effort */ }
    }

    return {
      title: source.title,
      type: source.type,
      wordCount,
      detectedTopics: source.tags || [],
      wikiConnections: connections.slice(0, 5),
      excerpt: rawContent.slice(0, 200).replace(/\n/g, ' ').trim(),
    };
  } finally {
    db.close();
  }
}

export function formatPreview(preview: IngestPreview): string {
  let msg = `  "${preview.title}" (${preview.type}, ${preview.wordCount.toLocaleString()} words)`;
  if (preview.detectedTopics.length > 0) {
    msg += `\n  Topics: ${preview.detectedTopics.join(', ')}`;
  }
  if (preview.wikiConnections.length > 0) {
    msg += `\n  Connects to: ${preview.wikiConnections.map(c => `[[${c.slug}]]`).join(', ')}`;
  }
  msg += `\n  "${preview.excerpt}..."`;
  return msg;
}
