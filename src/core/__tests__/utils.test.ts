import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { safePath, safeParseJSON, checkFileSize, clampInt, slugify } from '../utils.js';

// ── safePath ──────────────────────────────────────────────────────

describe('safePath', () => {
  it('allows simple filenames', () => {
    const result = safePath('/base', 'file.txt');
    expect(result).toBe(join('/base', 'file.txt'));
  });

  it('allows nested paths within base', () => {
    const result = safePath('/base', 'sub/file.txt');
    expect(result).toBe(join('/base', 'sub/file.txt'));
  });

  it('blocks ../ traversal', () => {
    expect(() => safePath('/base/dir', '../secret')).toThrow('Path traversal blocked');
  });

  it('blocks ../../ deep traversal', () => {
    expect(() => safePath('/base/dir', '../../etc/passwd')).toThrow('Path traversal blocked');
  });

  it('blocks traversal hidden in nested path', () => {
    expect(() => safePath('/base', 'sub/../../etc/passwd')).toThrow('Path traversal blocked');
  });

  it('blocks absolute paths', () => {
    expect(() => safePath('/base', '/etc/passwd')).toThrow('Path traversal blocked');
  });

  it('blocks null bytes in filename', () => {
    expect(() => safePath('/base', 'file\0.txt')).toThrow('Path contains null bytes');
  });

  it('blocks null bytes in base', () => {
    expect(() => safePath('/base\0', 'file.txt')).toThrow('Path contains null bytes');
  });

  it('handles dots in filenames (not traversal)', () => {
    const result = safePath('/base', 'file.name.txt');
    expect(result).toBe(join('/base', 'file.name.txt'));
  });

  it('handles single dot (current dir)', () => {
    const result = safePath('/base', './file.txt');
    expect(result).toBe(join('/base', 'file.txt'));
  });
});

// ── safeParseJSON ─────────────────────────────────────────────────

describe('safeParseJSON', () => {
  it('parses valid JSON', () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null on invalid JSON', () => {
    expect(safeParseJSON('{broken')).toBe(null);
  });

  it('returns null on empty string', () => {
    expect(safeParseJSON('')).toBe(null);
  });

  it('strips UTF-16 BOM (U+FEFF)', () => {
    expect(safeParseJSON('\uFEFF{"a":1}')).toEqual({ a: 1 });
  });

  it('strips UTF-8 BOM (0xEF 0xBB 0xBF)', () => {
    const bom = String.fromCharCode(0xEF, 0xBB, 0xBF);
    expect(safeParseJSON(bom + '{"a":1}')).toEqual({ a: 1 });
  });

  it('parses arrays', () => {
    expect(safeParseJSON('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses primitives', () => {
    expect(safeParseJSON('"hello"')).toBe('hello');
    expect(safeParseJSON('42')).toBe(42);
    expect(safeParseJSON('null')).toBe(null);
  });

  it('returns null on HTML instead of JSON', () => {
    expect(safeParseJSON('<html>not json</html>')).toBe(null);
  });
});

// ── checkFileSize ─────────────────────────────────────────────────

describe('checkFileSize', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browzy-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes for small files', () => {
    const file = join(tmpDir, 'small.txt');
    writeFileSync(file, 'hello');
    expect(() => checkFileSize(file)).not.toThrow();
  });

  it('throws for files exceeding limit', () => {
    const file = join(tmpDir, 'big.txt');
    writeFileSync(file, 'x'.repeat(1024));
    expect(() => checkFileSize(file, 100)).toThrow('File too large');
  });

  it('throws for directories', () => {
    const dir = join(tmpDir, 'subdir');
    mkdirSync(dir, { recursive: true });
    expect(() => checkFileSize(dir)).toThrow('Cannot read a directory');
  });

  it('throws for nonexistent files', () => {
    expect(() => checkFileSize(join(tmpDir, 'nope.txt'))).toThrow();
  });

  it('allows files exactly at the limit', () => {
    const file = join(tmpDir, 'exact.txt');
    writeFileSync(file, 'x'.repeat(100));
    expect(() => checkFileSize(file, 100)).not.toThrow();
  });
});

// ── clampInt ──────────────────────────────────────────────────────

describe('clampInt', () => {
  it('parses valid integers', () => {
    expect(clampInt('10', 1, 100, 20)).toBe(10);
  });

  it('clamps below min', () => {
    expect(clampInt('0', 1, 100, 20)).toBe(1);
  });

  it('clamps above max', () => {
    expect(clampInt('999', 1, 100, 20)).toBe(100);
  });

  it('returns fallback on NaN', () => {
    expect(clampInt('abc', 1, 100, 20)).toBe(20);
  });

  it('returns fallback on empty string', () => {
    expect(clampInt('', 1, 100, 20)).toBe(20);
  });

  it('handles negative input', () => {
    expect(clampInt('-5', 1, 100, 20)).toBe(1);
  });

  it('handles float input (truncates to int)', () => {
    expect(clampInt('10.9', 1, 100, 20)).toBe(10);
  });
});

// ── slugify ───────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips special characters', () => {
    expect(slugify('Hello, World! (2024)')).toBe('hello-world-2024');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('a---b---c')).toBe('a-b-c');
  });

  it('strips leading/trailing dashes', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  it('truncates to 60 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(60);
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles only special chars', () => {
    expect(slugify('!@#$%')).toBe('');
  });

  it('blocks path traversal characters', () => {
    const slug = slugify('../../etc/passwd');
    expect(slug).not.toContain('..');
    expect(slug).not.toContain('/');
  });
});
