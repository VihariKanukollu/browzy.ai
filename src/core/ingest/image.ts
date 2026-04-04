import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import { lookup } from 'mime-types';
import type { RawSource } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';
import { IMAGE_DESCRIPTION_PROMPT } from '../prompts.js';
import { slugify, checkFileSize } from '../utils.js';
import { sanitizeUnicode } from '../sanitization.js';

const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function ingestImage(
  filePath: string,
  dataDir: string,
  llm?: LLMProvider
): Promise<RawSource> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  checkFileSize(filePath, MAX_IMAGE_SIZE);

  const ext = extname(filePath).toLowerCase();
  const title = sanitizeUnicode(basename(filePath, ext));
  const id = createHash('sha256').update(filePath).digest('hex').slice(0, 12);

  // Copy image to images directory
  const imgFilename = `${id}${ext}`;
  const imgDest = join(dataDir, 'raw', 'images', imgFilename);
  copyFileSync(filePath, imgDest);

  // Generate description via LLM if available
  let description = `![${title}](images/${imgFilename})`;
  if (llm) {
    const imageData = readFileSync(filePath).toString('base64');
    const mimeType = lookup(ext) || 'image/png';
    try {
      const response = await llm.chat(
        [
          {
            role: 'user',
            content: `Describe this image in detail. The image is: ${title}`,
          },
        ],
        { system: IMAGE_DESCRIPTION_PROMPT }
      );
      description = `![${title}](images/${imgFilename})\n\n## Description\n\n${sanitizeUnicode(response.content)}`;
    } catch {
      description = `![${title}](images/${imgFilename})\n\n*Image description pending — LLM unavailable during ingest.*`;
    }
  }

  const filename = `${slugify(title)}-${id}.md`;
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: ${JSON.stringify(filePath)}`,
    `type: image`,
    `image: ${JSON.stringify('images/' + imgFilename)}`,
    `ingested: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    '',
  ].join('\n');

  const outputPath = join(dataDir, 'raw', filename);
  writeFileSync(outputPath, frontmatter + description, 'utf-8');

  return {
    id,
    type: 'image',
    title,
    origin: filePath,
    path: outputPath,
    images: [imgDest],
    ingestedAt: new Date().toISOString(),
  };
}
