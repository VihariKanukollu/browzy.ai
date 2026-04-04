import Database from 'better-sqlite3';
import { join } from 'path';
import type { SearchResult } from '../types.js';
import { runMigrations } from './migrations.js';

export class SQLiteStorage {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbPath = join(dataDir, '.browzy', 'browzy.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.init(dbPath);
  }

  private init(dbPath: string): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        origin TEXT NOT NULL,
        path TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        ingested_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS articles (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    runMigrations(this.db, dbPath);
  }

  // ── Sources ──────────────────────────────────────────────────

  upsertSource(source: {
    id: string;
    type: string;
    title: string;
    origin: string;
    path: string;
    summary?: string;
    tags?: string[];
    ingestedAt: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sources (id, type, title, origin, path, summary, tags, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id,
      source.type,
      source.title,
      source.origin,
      source.path,
      source.summary ?? null,
      source.tags ? JSON.stringify(source.tags) : null,
      source.ingestedAt
    );
  }

  getSource(id: string) {
    return this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  }

  listSources() {
    return this.db.prepare('SELECT * FROM sources ORDER BY ingested_at DESC').all();
  }

  // ── Articles (Search Index) ──────────────────────────────────

  indexArticle(article: {
    slug: string;
    title: string;
    summary: string;
    content: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }): void {
    const tagsStr = article.tags.join(', ');

    // Article upsert + FTS index update in a single atomic transaction
    const upsertArticle = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO articles (slug, title, summary, tags, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        article.slug, article.title, article.summary, tagsStr,
        article.content, article.createdAt, article.updatedAt
      );

      this.db.prepare('DELETE FROM articles_fts WHERE slug = ?').run(article.slug);
      this.db.prepare(`
        INSERT INTO articles_fts (slug, title, summary, content, tags)
        VALUES (?, ?, ?, ?, ?)
      `).run(article.slug, article.title, article.summary, article.content, tagsStr);
    });
    upsertArticle();
  }

  removeArticle(slug: string): void {
    this.db.prepare('DELETE FROM articles WHERE slug = ?').run(slug);
    this.db.prepare('DELETE FROM articles_fts WHERE slug = ?').run(slug);
  }

  search(query: string, limit = 50): SearchResult[] {
    limit = Math.min(Math.max(limit, 1), 1000);
    // Sanitize query for FTS5: strip special chars, quote each term
    const sanitized = query
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0)
      .map(t => `"${t}"`)
      .join(' OR ');

    if (!sanitized) return [];

    // BM25 weights by column declaration order:
    // slug=0 (UNINDEXED), title=10.0, summary=5.0, content=1.0, tags=8.0
    const rows = this.db.prepare(`
      SELECT slug, title, snippet(articles_fts, 3, '<mark>', '</mark>', '...', 32) as snippet,
             bm25(articles_fts, 0, 10.0, 5.0, 1.0, 8.0) as rank
      FROM articles_fts
      WHERE articles_fts MATCH ?
      ORDER BY bm25(articles_fts, 0, 10.0, 5.0, 1.0, 8.0)
      LIMIT ?
    `).all(sanitized, limit) as Array<{ slug: string; title: string; snippet: string; rank: number }>;

    return rows.map(row => ({
      slug: row.slug,
      title: row.title,
      snippet: row.snippet,
      score: -row.rank, // BM25 returns negative values; more negative = better match
    }));
  }

  close(): void {
    this.db.close();
  }
}
