import { statSync } from 'fs';
import { relative, resolve, isAbsolute, sep } from 'path';

// ── Shared Slugify ────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ── Safe Path (cross-platform) ────────────────────────────────────

export function safePath(base: string, filename: string): string {
  const resolvedBase = resolve(base);
  const resolved = resolve(base, filename);
  const rel = relative(resolvedBase, resolved);

  // Block traversal: relative path must not start with '..' or be absolute
  if (rel.startsWith('..') || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: ${filename}`);
  }

  // Block null bytes (directory traversal via null byte injection)
  if (base.includes('\0') || filename.includes('\0') || resolved.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  return resolved;
}

// ── Safe JSON Parse ───────────────────────────────────────────────

function stripBOM(text: string): string {
  // UTF-16 BOM
  if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  // UTF-8 BOM (0xEF 0xBB 0xBF) — shows up as these chars when decoded as UTF-8
  if (text.charCodeAt(0) === 0xEF && text.charCodeAt(1) === 0xBB && text.charCodeAt(2) === 0xBF) return text.slice(3);
  return text;
}

export function safeParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(stripBOM(text));
  } catch {
    return null;
  }
}

// ── File Size Guard ───────────────────────────────────────────────

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export function checkFileSize(filePath: string, maxBytes = MAX_FILE_SIZE): void {
  const stats = statSync(filePath);

  // Block directories
  if (stats.isDirectory()) {
    throw new Error('Cannot read a directory as a file');
  }

  // Block special file types that can hang or behave dangerously
  if (stats.isFIFO() || stats.isSocket() || stats.isCharacterDevice() || stats.isBlockDevice()) {
    throw new Error('Cannot read special file types (FIFO, socket, device)');
  }

  if (stats.size > maxBytes) {
    throw new Error(
      `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${(maxBytes / 1024 / 1024).toFixed(1)}MB`
    );
  }
}

// ── Fetch with Timeout ────────────────────────────────────────────

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const existingSignal = fetchOptions.signal;

  // If parent signal exists, propagate abort
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
    } else {
      existingSignal.addEventListener('abort', () => controller.abort(existingSignal.reason), { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      redirect: 'manual', // Never auto-follow redirects
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ── Integer Clamping ──────────────────────────────────────────────

export function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
