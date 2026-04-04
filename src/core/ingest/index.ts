import { extname } from 'path';
import type { RawSource, SourceType } from '../types.js';
import type { LLMProvider } from '../llm/provider.js';
import { FilesystemStorage } from '../storage/filesystem.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import { ingestWeb } from './web.js';
import { ingestPdf } from './pdf.js';
import { ingestText } from './text.js';
import { ingestImage } from './image.js';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

/**
 * Detect source type from input string (URL or file path).
 */
export function detectSourceType(input: string): SourceType {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return 'web';
  }
  const ext = extname(input).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === '.md') return 'markdown';
  return 'text';
}

/**
 * Ingest a source into the knowledge base.
 */
export async function ingest(
  input: string,
  dataDir: string,
  options?: { llm?: LLMProvider; type?: SourceType }
): Promise<RawSource> {
  const type = options?.type ?? detectSourceType(input);

  let source: RawSource;
  switch (type) {
    case 'web':
      source = await ingestWeb(input, dataDir);
      break;
    case 'pdf':
      source = await ingestPdf(input, dataDir);
      break;
    case 'image':
      source = await ingestImage(input, dataDir, options?.llm);
      break;
    case 'markdown':
    case 'text':
      source = await ingestText(input, dataDir);
      break;
    default:
      throw new Error(`Unsupported source type: ${type}`);
  }

  // Update manifest
  const fs = new FilesystemStorage(dataDir);
  const manifest = fs.getRawManifest();
  // Replace if same origin exists, otherwise append
  const existing = manifest.findIndex(s => s.origin === source.origin);
  if (existing >= 0) {
    manifest[existing] = source;
  } else {
    manifest.push(source);
  }
  fs.writeRawManifest(manifest);

  // Index in SQLite
  const db = new SQLiteStorage(dataDir);
  db.upsertSource({
    id: source.id,
    type: source.type,
    title: source.title,
    origin: source.origin,
    path: source.path,
    summary: source.summary,
    tags: source.tags,
    ingestedAt: source.ingestedAt,
  });
  db.close();

  return source;
}

export { ingestWeb, ingestPdf, ingestText, ingestImage };
