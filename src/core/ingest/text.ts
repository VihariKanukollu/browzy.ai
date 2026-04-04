import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import type { RawSource, SourceType } from '../types.js';

/**
 * Ingest plain text or markdown files.
 */
export async function ingestText(
  filePath: string,
  dataDir: string
): Promise<RawSource> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();
  const type: SourceType = ext === '.md' ? 'markdown' : 'text';
  const title = basename(filePath, ext);
  const id = createHash('md5').update(filePath).digest('hex').slice(0, 12);
  const filename = `${slugify(title)}-${id}.md`;

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: "${filePath}"`,
    `type: ${type}`,
    `ingested: "${new Date().toISOString()}"`,
    '---',
    '',
  ].join('\n');

  const outputPath = join(dataDir, 'raw', filename);
  writeFileSync(outputPath, frontmatter + content, 'utf-8');

  return {
    id,
    type,
    title,
    origin: filePath,
    path: outputPath,
    images: [],
    ingestedAt: new Date().toISOString(),
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
