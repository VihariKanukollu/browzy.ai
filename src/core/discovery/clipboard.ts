/**
 * Clipboard watcher — opt-in only.
 * Polls the system clipboard for new text content (>50 words, not a URL, not code-heavy).
 * OFF by default. Enable via config.clipboard.enabled = true.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

let lastClipContent = '';
let initialized = false;

export async function getClipboardText(): Promise<string | null> {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      const { stdout } = await exec('pbpaste', { encoding: 'utf-8', timeout: 1000 });
      return stdout;
    } else if (platform === 'linux') {
      try {
        const { stdout } = await exec('xclip -selection clipboard -o', { encoding: 'utf-8', timeout: 1000 });
        return stdout;
      } catch {
        const { stdout } = await exec('xsel --clipboard --output', { encoding: 'utf-8', timeout: 1000 });
        return stdout;
      }
    } else if (platform === 'win32') {
      const { stdout } = await exec('powershell -command Get-Clipboard', { encoding: 'utf-8', timeout: 2000 });
      return stdout;
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkClipboardChange(): Promise<string | null> {
  // Lazy init: capture current clipboard on first poll to avoid ingesting stale content
  if (!initialized) {
    initialized = true;
    lastClipContent = (await getClipboardText()) || '';
    return null;
  }

  const current = await getClipboardText();
  if (!current) return null;
  if (current === lastClipContent) return null;

  lastClipContent = current;

  // Must be >50 words, not code-heavy
  const trimmed = current.trim();
  const words = trimmed.split(/\s+/).length;
  if (words < 50) return null;

  // Only skip if clipboard content is JUST a URL (no surrounding text)
  if (/^https?:\/\/\S+$/i.test(trimmed)) return null;

  // Skip content that looks like API keys or sensitive data
  if (/(?:sk-[a-zA-Z0-9_-]{20,}|AKIA[A-Z0-9]{16}|\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b)/i.test(trimmed)) return null;

  // Skip code-heavy content (lots of braces, semicolons, or indentation)
  const codeSignals = (current.match(/[{};()=>]/g) || []).length;
  if (codeSignals > words * 0.15) return null;

  return current;
}

export async function initClipboard(): Promise<void> {
  // Initialize with current clipboard so we don't immediately ingest existing content
  lastClipContent = (await getClipboardText()) || '';
  initialized = true;
}
