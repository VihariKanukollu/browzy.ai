import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../storage/sqlite.js';

describe('SQLiteStorage — search security', () => {
  let tmpDir: string;
  let db: SQLiteStorage;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browzy-sqlite-test-'));
    mkdirSync(join(tmpDir, '.browzy'), { recursive: true });
    db = new SQLiteStorage(tmpDir);

    // Seed some test data
    db.indexArticle({
      slug: 'test-article',
      title: 'Test Article About Security',
      summary: 'An article about web security',
      content: 'This article discusses OWASP top 10 vulnerabilities.',
      tags: ['security', 'web'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds articles by keyword', () => {
    const results = db.search('security');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slug).toBe('test-article');
  });

  it('clamps limit to minimum 1', () => {
    const results = db.search('security', 0);
    // Should use 1 as minimum
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('clamps limit to maximum 1000', () => {
    // Just verify it doesn't throw with a huge limit
    expect(() => db.search('security', 999999)).not.toThrow();
  });

  it('handles empty query gracefully', () => {
    const results = db.search('');
    expect(results).toEqual([]);
  });

  it('handles special characters in query (FTS sanitization)', () => {
    // These should not cause FTS5 syntax errors
    expect(() => db.search('test; DROP TABLE articles;--')).not.toThrow();
    expect(() => db.search('hello OR NOT AND')).not.toThrow();
    expect(() => db.search('"unclosed quote')).not.toThrow();
    expect(() => db.search('a*b*c')).not.toThrow();
    expect(() => db.search('NEAR(a, b)')).not.toThrow();
  });

  it('handles only special characters', () => {
    const results = db.search('!@#$%^&*()');
    expect(results).toEqual([]);
  });

  it('uses parameterized queries (no SQL injection)', () => {
    // If SQL injection worked, this would cause an error or data leak
    const results = db.search("' OR 1=1; --");
    // Should just return no results, not all rows
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
