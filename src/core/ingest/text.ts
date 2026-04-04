import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import type { RawSource, SourceType } from '../types.js';
import { slugify, checkFileSize } from '../utils.js';
import { sanitizeUnicode } from '../sanitization.js';

const MAX_TEXT_SIZE = 50 * 1024 * 1024; // 50 MB

export async function ingestText(
  filePath: string,
  dataDir: string
): Promise<RawSource> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  checkFileSize(filePath, MAX_TEXT_SIZE);

  const content = sanitizeUnicode(readFileSync(filePath, 'utf-8'));
  const ext = extname(filePath).toLowerCase();
  const type: SourceType = ext === '.md' ? 'markdown' : 'text';
  const title = sanitizeUnicode(basename(filePath, ext));
  const id = createHash('sha256').update(filePath).digest('hex').slice(0, 12);
  const filename = `${slugify(title)}-${id}.md`;

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: ${JSON.stringify(filePath)}`,
    `type: ${type}`,
    `ingested: ${JSON.stringify(new Date().toISOString())}`,
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
