import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import matter from 'gray-matter';
import type { WikiArticle, ArticleFrontmatter, RawSource, WikiIndex } from '../types.js';
import { safePath, safeParseJSON } from '../utils.js';

export class FilesystemStorage {
  constructor(private dataDir: string) {}

  private get rawDir() { return join(this.dataDir, 'raw'); }
  private get wikiDir() { return join(this.dataDir, 'wiki'); }
  private get outputDir() { return join(this.dataDir, 'output'); }
  private get imagesDir() { return join(this.dataDir, 'raw', 'images'); }

  // ── Raw Sources ──────────────────────────────────────────────

  writeRawSource(filename: string, content: string): string {
    const path = safePath(this.rawDir, filename);
    writeFileSync(path, content, 'utf-8');
    return path;
  }

  writeImage(filename: string, data: Buffer): string {
    mkdirSync(this.imagesDir, { recursive: true });
    const path = safePath(this.imagesDir, filename);
    writeFileSync(path, data);
    return path;
  }

  readRawSource(filename: string): string {
    return readFileSync(safePath(this.rawDir, filename), 'utf-8');
  }

  listRawSources(): string[] {
    if (!existsSync(this.rawDir)) return [];
    return readdirSync(this.rawDir).filter(
      f => f.endsWith('.md') || f.endsWith('.txt')
    );
  }

  getRawManifest(): RawSource[] {
    const manifestPath = join(this.rawDir, '_manifest.json');
    if (!existsSync(manifestPath)) return [];
    const parsed = safeParseJSON(readFileSync(manifestPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  }

  writeRawManifest(manifest: RawSource[]): void {
    writeFileSync(
      join(this.rawDir, '_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );
  }

  // ── Wiki Articles ────────────────────────────────────────────

  readArticle(slug: string): WikiArticle | null {
    const path = safePath(this.wikiDir, `${slug}.md`);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const { data, content } = matter(raw);
    return {
      slug,
      frontmatter: data as ArticleFrontmatter,
      content,
      path,
    };
  }

  writeArticle(slug: string, frontmatter: ArticleFrontmatter, content: string): string {
    const path = safePath(this.wikiDir, `${slug}.md`);
    const fmData: Record<string, unknown> = { ...frontmatter };
    const output = matter.stringify(content, fmData);
    writeFileSync(path, output, 'utf-8');
    return path;
  }

  listArticles(): WikiArticle[] {
    if (!existsSync(this.wikiDir)) return [];
    return readdirSync(this.wikiDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => {
        const slug = basename(f, '.md');
        return this.readArticle(slug);
      })
      .filter((a): a is WikiArticle => a !== null);
  }

  deleteArticle(slug: string): void {
    const path = safePath(this.wikiDir, `${slug}.md`);
    if (existsSync(path)) unlinkSync(path);
  }

  // ── Wiki Index ───────────────────────────────────────────────

  readIndex(): WikiIndex | null {
    const path = join(this.wikiDir, '_index.json');
    if (!existsSync(path)) return null;
    const parsed = safeParseJSON(readFileSync(path, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as WikiIndex;
  }

  writeIndex(index: WikiIndex): void {
    writeFileSync(
      join(this.wikiDir, '_index.json'),
      JSON.stringify(index, null, 2),
      'utf-8'
    );
  }

  // ── Output ───────────────────────────────────────────────────

  writeOutput(filename: string, content: string): string {
    mkdirSync(this.outputDir, { recursive: true });
    const path = safePath(this.outputDir, filename);
    writeFileSync(path, content, 'utf-8');
    return path;
  }

  listOutputs(): string[] {
    if (!existsSync(this.outputDir)) return [];
    return readdirSync(this.outputDir);
  }
}
