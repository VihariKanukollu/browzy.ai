/**
 * Demo KB seeder — populates a fresh browzy install with starter articles
 * so users can explore immediately without an API key.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { SQLiteStorage } from '../storage/sqlite.js';
import { FilesystemStorage } from '../storage/filesystem.js';
import type { WikiIndex } from '../types.js';

// ── Demo Article Definitions ────────────────────────────────────

interface DemoArticle {
  slug: string;
  content: string; // Full markdown with YAML frontmatter
}

function getDemoArticlesDir(): string {
  // Resolve relative to this file's location in the built output
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // From dist/core/demo/ -> dist/demo/articles/ (or src/demo/articles/ in dev)
  const candidates = [
    join(thisDir, '..', '..', 'demo', 'articles'),   // dist/core/demo -> dist/demo/articles
    join(thisDir, '..', '..', '..', 'src', 'demo', 'articles'), // fallback to src
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  // If neither exists, return first candidate (will be caught by caller)
  return candidates[0];
}

function loadDemoArticles(): DemoArticle[] {
  const articlesDir = getDemoArticlesDir();
  if (!existsSync(articlesDir)) return [];

  return readdirSync(articlesDir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      slug: f.replace(/\.md$/, ''),
      content: readFileSync(join(articlesDir, f), 'utf-8'),
    }));
}

// ── Seeder ──────────────────────────────────────────────────────

/**
 * Seed the demo knowledge base on first run.
 *
 * - Writes demo articles to the wiki directory
 * - Creates and populates the SQLite FTS5 index
 * - Creates the wiki index (_index.json)
 * - Idempotent: skips if wiki articles already exist
 *
 * @returns true if seeding was performed, false if skipped
 */
export function seedDemoKB(dataDir: string): boolean {
  const wikiDir = join(dataDir, 'wiki');
  const browzyDir = join(dataDir, '.browzy');

  // Skip if demo has already been seeded (use marker file instead of checking for any .md)
  const markerFile = join(browzyDir, '.demo-seeded');
  if (existsSync(markerFile)) return false;

  // Load demo articles from bundled files
  const demoArticles = loadDemoArticles();
  if (demoArticles.length === 0) return false;

  // Create directory structure
  mkdirSync(wikiDir, { recursive: true });
  mkdirSync(join(dataDir, 'raw'), { recursive: true });
  mkdirSync(join(dataDir, 'raw', 'images'), { recursive: true });
  mkdirSync(join(dataDir, 'output'), { recursive: true });
  mkdirSync(browzyDir, { recursive: true });

  // Build wiki index (markdown files are written after successful SQLite indexing below)
  const indexArticles: WikiIndex['articles'] = [];
  const conceptMap = new Map<string, string[]>();

  // Create SQLite DB and populate FTS index BEFORE writing markdown files,
  // so a failure here doesn't leave a half-seeded state
  const db = new SQLiteStorage(dataDir);

  try {
    for (const article of demoArticles) {
      const { data: fm, content } = matter(article.content);

      const tags = Array.isArray(fm.tags) ? fm.tags : [];
      const summary = typeof fm.summary === 'string' ? fm.summary : '';
      const title = typeof fm.title === 'string' ? fm.title : article.slug;
      const createdAt = typeof fm.created === 'string' ? fm.created : new Date().toISOString();
      const updatedAt = typeof fm.updated === 'string' ? fm.updated : new Date().toISOString();

      // Add to index
      indexArticles.push({ slug: article.slug, title, summary, tags });

      // Track concepts from tags
      for (const tag of tags) {
        const existing = conceptMap.get(tag) || [];
        existing.push(article.slug);
        conceptMap.set(tag, existing);
      }

      // Index in SQLite for FTS search
      db.indexArticle({
        slug: article.slug,
        title,
        summary,
        content: content.trim(),
        tags,
        createdAt,
        updatedAt,
      });
    }
  } finally {
    db.close();
  }

  // Write markdown files AFTER successful SQLite indexing
  for (const article of demoArticles) {
    writeFileSync(join(wikiDir, `${article.slug}.md`), article.content, 'utf-8');
  }

  // Write wiki index
  const wikiIndex: WikiIndex = {
    articles: indexArticles,
    concepts: Array.from(conceptMap.entries()).map(([name, articles]) => ({
      name,
      articles,
    })),
    lastCompiled: new Date().toISOString(),
  };

  writeFileSync(
    join(wikiDir, '_index.json'),
    JSON.stringify(wikiIndex, null, 2),
    'utf-8',
  );

  // Write marker file so we don't re-seed on next run
  writeFileSync(markerFile, new Date().toISOString(), 'utf-8');

  return true;
}
