import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, mkdtempSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import matter from 'gray-matter';
import { SQLiteStorage } from '../../src/core/storage/sqlite.js';
import { estimateTokens } from '../../src/core/retrieval/tokenCounter.js';
import { extractSections, rankArticles } from '../../src/core/retrieval/relevanceRanker.js';
import { queryCache } from '../../src/core/retrieval/queryCache.js';
import type { WikiArticle } from '../../src/core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'articles');

/**
 * Load all fixture articles from the fixtures/articles directory.
 * Parses YAML frontmatter and returns WikiArticle objects.
 */
function loadFixtureArticles(): WikiArticle[] {
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.md'));
  return files.map(file => {
    const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
    const { data, content } = matter(raw);
    const slug = file.replace(/\.md$/, '');
    return {
      slug,
      frontmatter: {
        title: data.title ?? slug,
        tags: data.tags ?? [],
        sources: data.sources ?? [],
        backlinks: data.backlinks ?? [],
        created: String(data.created ?? ''),
        updated: String(data.updated ?? ''),
        summary: data.summary ?? '',
      },
      content: content.trim(),
      path: join(FIXTURES_DIR, file),
    };
  });
}

describe('Phase 3 E2E Verification', () => {
  let tmpDir: string;
  let db: SQLiteStorage;
  let articles: WikiArticle[];

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browzy-e2e-'));
    mkdirSync(join(tmpDir, '.browzy'), { recursive: true });
    db = new SQLiteStorage(tmpDir);

    articles = loadFixtureArticles();
    expect(articles.length).toBe(10);

    // Index all fixture articles into the DB
    for (const article of articles) {
      db.indexArticle({
        slug: article.slug,
        title: article.frontmatter.title,
        summary: article.frontmatter.summary,
        content: article.content,
        tags: article.frontmatter.tags,
        createdAt: article.frontmatter.created,
        updatedAt: article.frontmatter.updated,
      });
    }
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Retrieval Quality ────────────────────────────────────────

  describe('1. Retrieval Quality', () => {
    it('should return attention-mechanism for "how does attention work in transformers"', () => {
      const results = db.search('attention transformers', 3);
      expect(results.some(r => r.slug === 'attention-mechanism')).toBe(true);
    });

    it('should return react-hooks for "react hooks useState"', () => {
      const results = db.search('react hooks useState', 3);
      expect(results.some(r => r.slug === 'react-hooks')).toBe(true);
    });

    it('should return neural-networks for "activation functions layers"', () => {
      const results = db.search('activation functions layers', 5);
      expect(results.some(r => r.slug === 'neural-networks')).toBe(true);
    });

    it('should return backpropagation for "gradient descent chain rule"', () => {
      const results = db.search('gradient descent chain rule', 5);
      expect(results.some(r => r.slug === 'backpropagation')).toBe(true);
    });

    it('should return typescript-generics for "generic types constraints"', () => {
      const results = db.search('generic types constraints', 5);
      expect(results.some(r => r.slug === 'typescript-generics')).toBe(true);
    });

    it('should return css-grid for "grid layout responsive fr units"', () => {
      const results = db.search('grid layout responsive fr units', 5);
      expect(results.some(r => r.slug === 'css-grid')).toBe(true);
    });

    it('should return database-indexing for "B-tree query optimization"', () => {
      const results = db.search('B-tree query optimization', 5);
      expect(results.some(r => r.slug === 'database-indexing')).toBe(true);
    });

    it('should return distributed-systems for "CAP theorem consensus"', () => {
      const results = db.search('CAP theorem consensus', 5);
      expect(results.some(r => r.slug === 'distributed-systems')).toBe(true);
    });

    it('should return pandas-dataframes for "DataFrame groupby merge"', () => {
      const results = db.search('DataFrame groupby merge', 5);
      expect(results.some(r => r.slug === 'pandas-dataframes')).toBe(true);
    });

    it('should return statistical-testing for "hypothesis testing p-values"', () => {
      const results = db.search('hypothesis testing p-values', 5);
      expect(results.some(r => r.slug === 'statistical-testing')).toBe(true);
    });

    it('should rank cluster-relevant articles higher than unrelated ones', () => {
      // ML query should not surface web dev or data science articles at top
      const results = db.search('neural network backpropagation gradient', 10);
      const top3Slugs = results.slice(0, 3).map(r => r.slug);
      const mlSlugs = ['neural-networks', 'backpropagation', 'attention-mechanism'];
      const mlInTop3 = top3Slugs.filter(s => mlSlugs.includes(s)).length;
      expect(mlInTop3).toBeGreaterThanOrEqual(2);
    });

    it('should not return results for nonsense queries', () => {
      const results = db.search('xyzzyplugh42 asdfqwer', 5);
      expect(results.length).toBe(0);
    });
  });

  // ── 2. Stemming (Porter Tokenizer) ─────────────────────────────

  describe('2. Stemming', () => {
    it('should match "networks" to articles containing "network"', () => {
      const results = db.search('networks', 5);
      expect(results.some(r => r.slug === 'neural-networks')).toBe(true);
    });

    it('should match "optimization" to articles about "optimize"', () => {
      const results = db.search('optimization gradient', 5);
      expect(results.some(r => r.slug === 'backpropagation')).toBe(true);
    });

    it('should match "replicated" to articles about "replication"', () => {
      const results = db.search('replicated', 5);
      expect(results.some(r => r.slug === 'distributed-systems')).toBe(true);
    });

    it('should match "indexing" to articles containing "indexes"', () => {
      const results = db.search('indexing', 5);
      expect(results.some(r => r.slug === 'database-indexing')).toBe(true);
    });

    it('should match "responsive" to articles containing "responsive"', () => {
      const results = db.search('responsive design layout', 5);
      expect(results.some(r => r.slug === 'css-grid')).toBe(true);
    });
  });

  // ── 3. Token Counting ──────────────────────────────────────────

  describe('3. Token Counting', () => {
    it('should estimate tokens within 20% for pure prose', () => {
      const proseText = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
      const estimate = estimateTokens(proseText);
      // Standard prose ratio is ~4 chars per token
      const baseline = Math.ceil(proseText.length / 4);
      const deviation = Math.abs(estimate - baseline) / baseline;
      expect(deviation).toBeLessThan(0.20);
    });

    it('should handle code blocks with different ratio', () => {
      const code = '```\nconst x = 1;\nfunction foo() { return x; }\nconst arr = [1, 2, 3].map(n => n * 2);\n```';
      const codeEstimate = estimateTokens(code);
      // Code uses ~3.5 chars/token, so estimate should be higher than 4 chars/token baseline
      const proseBaseline = Math.ceil(code.length / 4);
      expect(codeEstimate).toBeGreaterThanOrEqual(proseBaseline);
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle mixed content (prose + code)', () => {
      const mixed = 'This is a paragraph of prose.\n\n```\nconst x = 42;\n```\n\nAnother paragraph.';
      const estimate = estimateTokens(mixed);
      expect(estimate).toBeGreaterThan(0);
      // Mixed content should be between pure prose and pure code estimates
      expect(estimate).toBeLessThan(mixed.length); // At least 1 char per token on average
    });

    it('should handle CJK characters with higher token density', () => {
      const cjk = '\u4F60\u597D\u4E16\u754C'.repeat(50); // 200 CJK chars
      const estimate = estimateTokens(cjk);
      // CJK uses ~2 chars per token
      const expectedMin = Math.ceil(200 / 3); // loose lower bound
      const expectedMax = Math.ceil(200 / 1); // loose upper bound
      expect(estimate).toBeGreaterThanOrEqual(expectedMin);
      expect(estimate).toBeLessThanOrEqual(expectedMax);
    });
  });

  // ── 4. Schema Migration ────────────────────────────────────────

  describe('4. Schema Migration', () => {
    it('should create schema_version table on fresh DB', () => {
      const freshDir = mkdtempSync(join(tmpdir(), 'browzy-migration-'));
      mkdirSync(join(freshDir, '.browzy'), { recursive: true });
      const freshDb = new SQLiteStorage(freshDir);

      // Access the underlying better-sqlite3 instance via search (indirect check)
      // Verify schema_version exists by opening a second connection

      const raw = new Database(join(freshDir, '.browzy', 'browzy.db'));
      const row = raw.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
      expect(row).toBeDefined();
      expect(row!.version).toBeGreaterThanOrEqual(1);

      raw.close();
      freshDb.close();
      rmSync(freshDir, { recursive: true, force: true });
    });

    it('should be idempotent (re-init does not error or change version)', () => {
      const idempotentDir = mkdtempSync(join(tmpdir(), 'browzy-idempotent-'));
      mkdirSync(join(idempotentDir, '.browzy'), { recursive: true });

      // First init
      const db1 = new SQLiteStorage(idempotentDir);
      db1.close();

      // Second init — should not throw
      const db2 = new SQLiteStorage(idempotentDir);


      const raw = new Database(join(idempotentDir, '.browzy', 'browzy.db'));
      const row = raw.prepare('SELECT version FROM schema_version').get() as { version: number };
      // Version should still be the latest migration version (2)
      expect(row.version).toBe(2);

      raw.close();
      db2.close();
      rmSync(idempotentDir, { recursive: true, force: true });
    });

    it('should create FTS5 table with porter tokenizer', () => {

      const raw = new Database(join(tmpDir, '.browzy', 'browzy.db'));
      const ftsTable = raw.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='articles_fts'"
      ).get() as { sql: string } | undefined;
      expect(ftsTable).toBeDefined();
      expect(ftsTable!.sql.toLowerCase()).toContain('porter');
      raw.close();
    });
  });

  // ── 5. Query Cache ─────────────────────────────────────────────

  describe('5. Query Cache', () => {
    it('should cache and return cached results', () => {
      queryCache.clear();
      const testResult = { answer: 'cached answer', sources: ['article-1'] };
      queryCache.set('test query', 'markdown', 'claude', testResult);
      const cached = queryCache.get('test query', 'markdown', 'claude');
      expect(cached).toEqual(testResult);
    });

    it('should return undefined for cache miss', () => {
      queryCache.clear();
      const result = queryCache.get('nonexistent query', 'markdown', 'claude');
      expect(result).toBeUndefined();
    });

    it('should differentiate by format and model', () => {
      queryCache.clear();
      queryCache.set('shared query', 'markdown', 'claude', { answer: 'md-claude' });
      queryCache.set('shared query', 'json', 'claude', { answer: 'json-claude' });
      queryCache.set('shared query', 'markdown', 'gpt-4o', { answer: 'md-gpt' });

      expect(queryCache.get('shared query', 'markdown', 'claude')).toEqual({ answer: 'md-claude' });
      expect(queryCache.get('shared query', 'json', 'claude')).toEqual({ answer: 'json-claude' });
      expect(queryCache.get('shared query', 'markdown', 'gpt-4o')).toEqual({ answer: 'md-gpt' });
    });

    it('should invalidate on generation bump', () => {
      queryCache.clear();
      queryCache.set('test', 'md', 'claude', { answer: 'old' });
      expect(queryCache.get('test', 'md', 'claude')).toEqual({ answer: 'old' });

      queryCache.invalidate();
      expect(queryCache.get('test', 'md', 'claude')).toBeUndefined();
    });

    it('should report correct size', () => {
      queryCache.clear();
      expect(queryCache.size).toBe(0);
      queryCache.set('q1', 'md', 'claude', { a: 1 });
      queryCache.set('q2', 'md', 'claude', { a: 2 });
      expect(queryCache.size).toBe(2);
    });
  });

  // ── 6. Smart Chunking (Section Extraction) ─────────────────────

  describe('6. Smart Chunking (Section Extraction)', () => {
    it('should extract sections from markdown with headers', () => {
      const content = articles.find(a => a.slug === 'attention-mechanism')!.content;
      const sections = extractSections(content);
      expect(sections.length).toBeGreaterThanOrEqual(3);
      // Should have named sections
      const headers = sections.map(s => s.header);
      expect(headers.some(h => h.includes('Self-Attention'))).toBe(true);
      expect(headers.some(h => h.includes('Multi-Head'))).toBe(true);
    });

    it('should include intro section for content before first header', () => {
      const content = '# Attention Mechanism in Transformers\n\nIntro paragraph.\n\n## Section 1\n\nContent.';
      const sections = extractSections(content);
      // The first H1 is treated as a header, content before ## is captured
      expect(sections.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle content with no headers', () => {
      const content = 'Just a plain paragraph without any markdown headers.';
      const sections = extractSections(content);
      expect(sections.length).toBe(1);
      expect(sections[0].header).toBe('(intro)');
    });

    it('should score sections by relevance to query terms', () => {
      const article = articles.find(a => a.slug === 'attention-mechanism')!;
      const scored = rankArticles([article], 'self-attention query key value', 1);
      expect(scored.length).toBe(1);
      const selfAttentionSection = scored[0].matchedSections.find(
        s => s.header.includes('Self-Attention')
      );
      expect(selfAttentionSection).toBeDefined();
      expect(selfAttentionSection!.relevanceScore).toBeGreaterThan(0);
    });
  });

  // ── 7. BM25 Column Weights ─────────────────────────────────────

  describe('7. BM25 Column Weights', () => {
    it('should rank title matches higher than body-only matches', () => {
      // "React Hooks" is in the title of react-hooks
      // "hooks" also appears in body of other articles, but title match should dominate
      const results = db.search('React Hooks', 5);
      expect(results[0].slug).toBe('react-hooks');
    });

    it('should rank tag matches higher than body-only matches', () => {
      // "backpropagation" is a tag on the backpropagation article
      const results = db.search('backpropagation', 3);
      expect(results[0].slug).toBe('backpropagation');
    });

    it('should return scored results with positive scores', () => {
      const results = db.search('attention mechanism', 3);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });
  });

  // ── 8. Latency ─────────────────────────────────────────────────

  describe('8. Latency', () => {
    it('should complete FTS search in <100ms', () => {
      const start = performance.now();
      db.search('attention mechanism neural network', 15);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it('should complete section extraction in <50ms', () => {
      const longArticle = articles.find(a => a.slug === 'attention-mechanism')!;
      const start = performance.now();
      extractSections(longArticle.content);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it('should complete token estimation in <10ms for large text', () => {
      const largeText = 'The quick brown fox jumps over the lazy dog. '.repeat(1000);
      const start = performance.now();
      estimateTokens(largeText);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(10);
    });

    it('should complete relevance ranking in <50ms for 10 articles', () => {
      const start = performance.now();
      rankArticles(articles, 'attention transformer neural network', 10);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
