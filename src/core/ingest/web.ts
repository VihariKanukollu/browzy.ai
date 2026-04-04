import TurndownService from 'turndown';
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { RawSource } from '../types.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export async function ingestWeb(
  url: string,
  dataDir: string
): Promise<RawSource> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const markdown = turndown.turndown(html);

  // Extract title from HTML
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || url;

  // Download images referenced in the HTML
  const images: string[] = [];
  const imgRegex = /<img[^>]+src="([^"]+)"/g;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    try {
      const imgUrl = new URL(match[1], url).href;
      const imgResponse = await fetch(imgUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
        });
      if (imgResponse.ok) {
        const buffer = Buffer.from(await imgResponse.arrayBuffer());
        const ext = imgUrl.split('.').pop()?.split('?')[0] || 'png';
        const imgFilename = `${createHash('md5').update(imgUrl).digest('hex').slice(0, 12)}.${ext}`;
        const imgPath = join(dataDir, 'raw', 'images', imgFilename);
        writeFileSync(imgPath, buffer);
        images.push(imgPath);
      }
    } catch {
      // Skip failed image downloads
    }
  }

  const id = createHash('md5').update(url).digest('hex').slice(0, 12);
  const filename = `${slugify(title)}-${id}.md`;

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: "${url}"`,
    `type: web`,
    `ingested: "${new Date().toISOString()}"`,
    '---',
    '',
  ].join('\n');

  const path = join(dataDir, 'raw', filename);
  writeFileSync(path, frontmatter + markdown, 'utf-8');

  return {
    id,
    type: 'web',
    title,
    origin: url,
    path,
    images,
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
