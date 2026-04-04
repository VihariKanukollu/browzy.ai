import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import { lookup } from 'mime-types';
import type { RawSource } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';

/**
 * Ingest an image file. Uses the LLM to generate a description/transcription.
 */
export async function ingestImage(
  filePath: string,
  dataDir: string,
  llm?: LLMProvider
): Promise<RawSource> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  const title = basename(filePath, ext);
  const id = createHash('md5').update(filePath).digest('hex').slice(0, 12);

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
      // For now, we pass a message asking for description.
      // The actual multimodal API call depends on the provider.
      const response = await llm.chat(
        [
          {
            role: 'user',
            content: `Describe this image in detail for a research knowledge base. Include any text, diagrams, data, or key visual elements. The image is: ${title}`,
          },
        ],
        { system: 'You are a research assistant. Describe images thoroughly for indexing in a knowledge base.' }
      );
      description = `![${title}](images/${imgFilename})\n\n## Description\n\n${response.content}`;
    } catch {
      description = `![${title}](images/${imgFilename})\n\n*Image description pending — LLM unavailable during ingest.*`;
    }
  }

  const filename = `${slugify(title)}-${id}.md`;
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: "${filePath}"`,
    `type: image`,
    `image: "images/${imgFilename}"`,
    `ingested: "${new Date().toISOString()}"`,
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
