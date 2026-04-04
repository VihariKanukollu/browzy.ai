import { readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import type { RawSource } from '../types.js';

export async function ingestPdf(
  filePath: string,
  dataDir: string
): Promise<RawSource> {
  const pdfParse = (await import('pdf-parse')).default;
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);

  const title = data.info?.Title || basename(filePath, '.pdf');
  const id = createHash('md5').update(filePath).digest('hex').slice(0, 12);
  const filename = `${slugify(title)}-${id}.md`;

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: "${filePath}"`,
    `type: pdf`,
    `pages: ${data.numpages}`,
    `ingested: "${new Date().toISOString()}"`,
    '---',
    '',
  ].join('\n');

  const outputPath = join(dataDir, 'raw', filename);
  writeFileSync(outputPath, frontmatter + data.text, 'utf-8');

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
