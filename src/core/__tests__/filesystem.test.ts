import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilesystemStorage } from '../storage/filesystem.js';

describe('FilesystemStorage — path traversal protection', () => {
  let tmpDir: string;
  let storage: FilesystemStorage;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browzy-fs-test-'));
    // Create required directory structure
    for (const dir of ['raw', 'raw/images', 'wiki', 'output']) {
      mkdirSync(join(tmpDir, dir), { recursive: true });
    }
    storage = new FilesystemStorage(tmpDir);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── writeRawSource ──────────────────────────────────────

  it('writeRawSource allows normal filenames', () => {
    const path = storage.writeRawSource('test.md', '# Hello');
    expect(path).toContain('test.md');
  });

  it('writeRawSource blocks ../ traversal', () => {
    expect(() => storage.writeRawSource('../../../etc/passwd', 'evil')).toThrow('Path traversal blocked');
  });

  it('writeRawSource blocks absolute paths', () => {
    expect(() => storage.writeRawSource('/etc/passwd', 'evil')).toThrow('Path traversal blocked');
  });

  it('writeRawSource blocks null bytes', () => {
    expect(() => storage.writeRawSource('file\0.md', 'evil')).toThrow('Path contains null bytes');
  });

  // ── readArticle ─────────────────────────────────────────

  it('readArticle blocks ../ traversal slugs', () => {
    expect(() => storage.readArticle('../../etc/passwd')).toThrow('Path traversal blocked');
  });

  // ── writeArticle ────────────────────────────────────────

  it('writeArticle blocks ../ traversal slugs', () => {
    const fm = {
      title: 'Test', tags: [], sources: [], backlinks: [],
      created: '', updated: '', summary: '',
    };
    expect(() => storage.writeArticle('../../evil', fm, 'content')).toThrow('Path traversal blocked');
  });

  // ── deleteArticle ───────────────────────────────────────

  it('deleteArticle blocks ../ traversal', () => {
    expect(() => storage.deleteArticle('../../etc/passwd')).toThrow('Path traversal blocked');
  });

  // ── writeOutput ─────────────────────────────────────────

  it('writeOutput blocks ../ traversal', () => {
    expect(() => storage.writeOutput('../../../etc/evil.md', 'content')).toThrow('Path traversal blocked');
  });

  // ── writeImage ──────────────────────────────────────────

  it('writeImage blocks ../ traversal', () => {
    expect(() => storage.writeImage('../../evil.png', Buffer.from('fake'))).toThrow('Path traversal blocked');
  });

  // ── JSON parsing resilience ─────────────────────────────

  it('getRawManifest returns empty array when manifest is missing', () => {
    expect(storage.getRawManifest()).toEqual([]);
  });

  it('getRawManifest returns empty array on corrupt JSON', () => {
    writeFileSync(join(tmpDir, 'raw', '_manifest.json'), '{corrupt');
    expect(storage.getRawManifest()).toEqual([]);
  });

  it('getRawManifest returns empty array when JSON is not an array', () => {
    writeFileSync(join(tmpDir, 'raw', '_manifest.json'), '{"not":"array"}');
    expect(storage.getRawManifest()).toEqual([]);
  });

  it('getRawManifest parses valid manifest', () => {
    writeFileSync(join(tmpDir, 'raw', '_manifest.json'), '[{"id":"test"}]');
    expect(storage.getRawManifest()).toEqual([{ id: 'test' }]);
  });

  it('readIndex returns null on missing file', () => {
    expect(storage.readIndex()).toBe(null);
  });

  it('readIndex returns null on corrupt JSON', () => {
    writeFileSync(join(tmpDir, 'wiki', '_index.json'), 'not json at all');
    expect(storage.readIndex()).toBe(null);
  });

  it('readIndex returns null when JSON is not an object', () => {
    writeFileSync(join(tmpDir, 'wiki', '_index.json'), '"just a string"');
    expect(storage.readIndex()).toBe(null);
  });
});
