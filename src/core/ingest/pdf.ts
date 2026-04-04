import { readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import type { RawSource } from '../types.js';
import { slugify, checkFileSize } from '../utils.js';
import { sanitizeUnicode } from '../sanitization.js';

const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB

export async function ingestPdf(
  filePath: string,
  dataDir: string
): Promise<RawSource> {
  checkFileSize(filePath, MAX_PDF_SIZE);

  const pdfParse = (await import('pdf-parse')).default;
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);

  const title = sanitizeUnicode(data.info?.Title || basename(filePath, '.pdf'));
  const id = createHash('sha256').update(filePath).digest('hex').slice(0, 12);
  const filename = `${slugify(title)}-${id}.md`;

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: ${JSON.stringify(filePath)}`,
    `type: pdf`,
    `pages: ${data.numpages}`,
    `ingested: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    '',
  ].join('\n');

  const outputPath = join(dataDir, 'raw', filename);
  writeFileSync(outputPath, frontmatter + sanitizeUnicode(data.text), 'utf-8');

  return {
    id,
    type: 'pdf',
    title,
    origin: filePath,
    path: outputPath,
    images: [],
    ingestedAt: new Date().toISOString(),
  };
}
